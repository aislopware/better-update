import { fromBase64, toBase64Url } from "@better-update/encoding";
import { compact, toOptional } from "@better-update/type-guards";
import { Effect, Schema } from "effect";

import type { EasAndroidSubmitReleaseStatus } from "./eas-submit-config";

export class GooglePlayAuthError extends Schema.TaggedError<GooglePlayAuthError>()(
  "GooglePlayAuthError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class GooglePlayApiError extends Schema.TaggedError<GooglePlayApiError>()(
  "GooglePlayApiError",
  {
    message: Schema.String,
    httpStatus: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANDROID_PUBLISHER_BASE = "https://androidpublisher.googleapis.com";
const ANDROID_UPLOAD_BASE = "https://androidpublisher.googleapis.com/upload";

const ServiceAccountJsonSchema = Schema.Struct({
  type: Schema.String,
  client_email: Schema.String,
  private_key: Schema.String,
  token_uri: Schema.optional(Schema.String),
});

const TokenResponseSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.optional(Schema.Number),
});

const stripPemHeaders = (pem: string): string =>
  pem
    .replace(/-----BEGIN [A-Z ]+-----/u, "")
    .replace(/-----END [A-Z ]+-----/u, "")
    .replaceAll(/\s+/gu, "");

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const importPrivateKey = (pem: string) =>
  Effect.tryPromise({
    try: async () => {
      const pkcs8 = fromBase64(stripPemHeaders(pem));
      return crypto.subtle.importKey(
        "pkcs8",
        asArrayBuffer(pkcs8),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      );
    },
    catch: (cause) =>
      new GooglePlayAuthError({ message: "Failed to import service account private key", cause }),
  });

const buildJwtAssertion = (params: {
  readonly clientEmail: string;
  readonly tokenUri: string;
  readonly nowSeconds: number;
}) => {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: params.clientEmail,
    scope: ANDROID_PUBLISHER_SCOPE,
    aud: params.tokenUri,
    exp: params.nowSeconds + 3600,
    iat: params.nowSeconds,
  };
  const encodedHeader = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  return `${encodedHeader}.${encodedClaims}`;
};

const signJwt = (key: CryptoKey, payload: string) =>
  Effect.tryPromise({
    try: async () => {
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(payload),
      );
      return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
    },
    catch: (cause) => new GooglePlayAuthError({ message: "Failed to sign JWT", cause }),
  });

const postTokenRequest = (tokenUri: string, jwt: string) =>
  Effect.tryPromise({
    try: async () => {
      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      });
      const response = await fetch(tokenUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    },
    catch: (cause) =>
      new GooglePlayAuthError({
        message: "Failed to exchange JWT for access token",
        cause,
      }),
  });

const exchangeJwtForAccessToken = (tokenUri: string, jwt: string) =>
  Effect.gen(function* () {
    const result = yield* postTokenRequest(tokenUri, jwt);
    if (!result.ok) {
      return yield* new GooglePlayAuthError({
        message: `OAuth token exchange failed: ${String(result.status)} ${result.text}`,
      });
    }
    const json = yield* Effect.try({
      try: (): unknown => JSON.parse(result.text),
      catch: (cause) =>
        new GooglePlayAuthError({ message: "OAuth token response is not JSON", cause }),
    });
    const decoded = yield* Schema.decodeUnknown(TokenResponseSchema)(json).pipe(
      Effect.mapError(
        (cause) =>
          new GooglePlayAuthError({
            message: "OAuth token response missing access_token",
            cause,
          }),
      ),
    );
    return decoded.access_token;
  });

export interface GooglePlayAccessToken {
  readonly accessToken: string;
  readonly clientEmail: string;
}

export const acquireGooglePlayAccessToken = (
  serviceAccountJson: string,
): Effect.Effect<GooglePlayAccessToken, GooglePlayAuthError> =>
  Effect.gen(function* () {
    const raw = yield* Effect.try({
      try: (): unknown => JSON.parse(serviceAccountJson),
      catch: (cause) =>
        new GooglePlayAuthError({
          message: "Service account JSON is not valid JSON",
          cause,
        }),
    });
    const parsed = yield* Schema.decodeUnknown(ServiceAccountJsonSchema)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new GooglePlayAuthError({
            message:
              "Service account JSON missing required fields (type, client_email, private_key)",
            cause,
          }),
      ),
    );
    if (parsed.type !== "service_account") {
      return yield* new GooglePlayAuthError({
        message: `Service account JSON has wrong type: ${parsed.type}`,
      });
    }
    const tokenUri = parsed.token_uri ?? GOOGLE_OAUTH_TOKEN_URL;
    const key = yield* importPrivateKey(parsed.private_key);
    const assertion = buildJwtAssertion({
      clientEmail: parsed.client_email,
      tokenUri,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    const jwt = yield* signJwt(key, assertion);
    const accessToken = yield* exchangeJwtForAccessToken(tokenUri, jwt);
    return { accessToken, clientEmail: parsed.client_email };
  });

const authHeaders = (accessToken: string): Record<string, string> => ({
  Authorization: `Bearer ${accessToken}`,
});

const performFetch = (params: {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly accessToken: string;
  readonly body?: unknown;
  readonly label: string;
}) =>
  Effect.tryPromise({
    try: async () => {
      const init: RequestInit =
        params.body === undefined
          ? { method: params.method, headers: authHeaders(params.accessToken) }
          : {
              method: params.method,
              headers: {
                ...authHeaders(params.accessToken),
                "Content-Type": "application/json",
              },
              body: JSON.stringify(params.body),
            };
      const response = await fetch(params.url, init);
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    },
    catch: (cause) => new GooglePlayApiError({ message: `${params.label} request failed`, cause }),
  });

const callJsonRaw = (params: {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly accessToken: string;
  readonly body?: unknown;
  readonly label: string;
}) =>
  Effect.gen(function* () {
    const result = yield* performFetch(params);
    if (!result.ok) {
      return yield* new GooglePlayApiError({
        message: `${params.label} failed: ${String(result.status)} ${result.text}`,
        httpStatus: result.status,
      });
    }
    return yield* Effect.try({
      try: (): unknown => (result.text === "" ? {} : JSON.parse(result.text)),
      catch: (cause) =>
        new GooglePlayApiError({ message: `${params.label} response is not JSON`, cause }),
    });
  });

const AppEditSchema = Schema.Struct({
  id: Schema.String,
  expiryTimeSeconds: Schema.optional(Schema.String),
});

export const insertEdit = (params: {
  readonly accessToken: string;
  readonly packageName: string;
}) =>
  Effect.gen(function* () {
    const raw = yield* callJsonRaw({
      url: `${ANDROID_PUBLISHER_BASE}/androidpublisher/v3/applications/${encodeURIComponent(params.packageName)}/edits`,
      method: "POST",
      accessToken: params.accessToken,
      body: {},
      label: "edits.insert",
    });
    return yield* Schema.decodeUnknown(AppEditSchema)(raw).pipe(
      Effect.mapError(
        (cause) => new GooglePlayApiError({ message: "edits.insert response missing id", cause }),
      ),
    );
  });

const UploadedBundleSchema = Schema.Struct({
  versionCode: Schema.Number,
  sha256: Schema.optional(Schema.String),
});

const performBundleUpload = (params: {
  readonly accessToken: string;
  readonly packageName: string;
  readonly editId: string;
  readonly aabBytes: Uint8Array;
}) =>
  Effect.tryPromise({
    try: async () => {
      const url = `${ANDROID_UPLOAD_BASE}/androidpublisher/v3/applications/${encodeURIComponent(params.packageName)}/edits/${encodeURIComponent(params.editId)}/bundles?uploadType=media`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...authHeaders(params.accessToken),
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(params.aabBytes),
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    },
    catch: (cause) =>
      new GooglePlayApiError({ message: "edits.bundles.upload request failed", cause }),
  });

export const uploadBundle = (params: {
  readonly accessToken: string;
  readonly packageName: string;
  readonly editId: string;
  readonly aabBytes: Uint8Array;
}) =>
  Effect.gen(function* () {
    const result = yield* performBundleUpload(params);
    if (!result.ok) {
      return yield* new GooglePlayApiError({
        message: `edits.bundles.upload failed: ${String(result.status)} ${result.text}`,
        httpStatus: result.status,
      });
    }
    const raw = yield* Effect.try({
      try: (): unknown => JSON.parse(result.text),
      catch: (cause) =>
        new GooglePlayApiError({
          message: "edits.bundles.upload response is not JSON",
          cause,
        }),
    });
    return yield* Schema.decodeUnknown(UploadedBundleSchema)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new GooglePlayApiError({
            message: "Bundle upload response missing versionCode",
            cause,
          }),
      ),
    );
  });

interface TrackReleasePayload {
  readonly status: EasAndroidSubmitReleaseStatus;
  readonly versionCodes: readonly [string];
  readonly userFraction?: number;
  readonly releaseNotes?: readonly { language: string; text: string }[];
}

export const updateTrack = (params: {
  readonly accessToken: string;
  readonly packageName: string;
  readonly editId: string;
  readonly track: string;
  readonly releaseStatus: EasAndroidSubmitReleaseStatus;
  readonly versionCode: number;
  readonly rollout: number | null;
  readonly releaseNotes?: string | undefined;
}) => {
  const release: TrackReleasePayload = {
    status: params.releaseStatus,
    versionCodes: [String(params.versionCode)],
    ...compact({
      userFraction: toOptional(params.rollout),
      releaseNotes: params.releaseNotes
        ? [{ language: "en-US", text: params.releaseNotes }]
        : undefined,
    }),
  };
  return callJsonRaw({
    url: `${ANDROID_PUBLISHER_BASE}/androidpublisher/v3/applications/${encodeURIComponent(params.packageName)}/edits/${encodeURIComponent(params.editId)}/tracks/${encodeURIComponent(params.track)}`,
    method: "PUT",
    accessToken: params.accessToken,
    body: { track: params.track, releases: [release] },
    label: "edits.tracks.update",
  });
};

export const commitEdit = (params: {
  readonly accessToken: string;
  readonly packageName: string;
  readonly editId: string;
  readonly changesNotSentForReview: boolean;
}) =>
  callJsonRaw({
    url: `${ANDROID_PUBLISHER_BASE}/androidpublisher/v3/applications/${encodeURIComponent(params.packageName)}/edits/${encodeURIComponent(params.editId)}:commit?changesNotSentForReview=${String(params.changesNotSentForReview)}`,
    method: "POST",
    accessToken: params.accessToken,
    label: "edits.commit",
  });
