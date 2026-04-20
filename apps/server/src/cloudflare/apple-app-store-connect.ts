import { toBase64Url } from "@better-update/encoding";
import { Context, Data, Effect, Layer } from "effect";

import { pemToPkcs8Der } from "../lib/apple-pem";
import {
  extractDeviceSingle,
  extractDevicesPage,
  extractErrors,
  extractList,
  extractSingle,
  mapDevice,
  toBundleId,
  toCertificate,
  toProfile,
} from "./apple-app-store-connect-mappers";

const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

// ── Domain types ───────────────────────────────────────────────────

export type AppleDeviceClass = "IPHONE" | "IPAD" | "MAC" | "APPLE_WATCH" | "APPLE_TV";
export type AppleDeviceStatus = "ENABLED" | "DISABLED" | "PROCESSING";

export interface AppleDevice {
  readonly id: string;
  readonly udid: string;
  readonly name: string;
  readonly model: string | null;
  readonly deviceClass: AppleDeviceClass;
  readonly status: AppleDeviceStatus;
  readonly addedDate: string;
}

export interface AppleCredentials {
  readonly teamIdentifier: string;
  readonly keyId: string;
  readonly issuerId: string;
  readonly p8Pem: string;
}

export type AppleProfileType =
  | "IOS_APP_ADHOC"
  | "IOS_APP_DEVELOPMENT"
  | "IOS_APP_STORE"
  | "IOS_APP_INHOUSE";

export type AppleCertificateType =
  | "DEVELOPMENT"
  | "DISTRIBUTION"
  | "IOS_DEVELOPMENT"
  | "IOS_DISTRIBUTION";

export interface AppleBundleId {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
}

export interface AppleCertificate {
  readonly id: string;
  readonly serialNumber: string;
  readonly certificateType: string;
  readonly displayName: string | null;
  readonly expirationDate: string;
}

export interface AppleProfile {
  readonly id: string;
  readonly name: string;
  readonly profileType: AppleProfileType;
  readonly uuid: string;
  readonly expirationDate: string;
  readonly profileContent: string;
}

// ── Errors ─────────────────────────────────────────────────────────

export class AppleAuthError extends Data.TaggedError("AppleAuthError")<{
  readonly cause: unknown;
}> {}

export class AppleApiError extends Data.TaggedError("AppleApiError")<{
  readonly status: number;
  readonly message: string;
  readonly code?: string;
}> {}

export class AppleNetworkError extends Data.TaggedError("AppleNetworkError")<{
  readonly cause: unknown;
}> {}

// ── JWT signing ────────────────────────────────────────────────────

const MAX_JWT_LIFETIME_SECONDS = 1200;

const signJwt = (credentials: AppleCredentials) =>
  Effect.gen(function* () {
    const header = { alg: "ES256", kid: credentials.keyId, typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.issuerId,
      iat: now,
      exp: now + MAX_JWT_LIFETIME_SECONDS,
      aud: "appstoreconnect-v1",
    };

    const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(header)));
    const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    const der = pemToPkcs8Der(credentials.p8Pem);
    if (der === null) {
      return yield* Effect.fail(new AppleAuthError({ cause: new Error("Invalid .p8 PEM") }));
    }

    const key = yield* Effect.tryPromise({
      try: async () =>
        crypto.subtle.importKey(
          "pkcs8",
          asArrayBuffer(der),
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        ),
      catch: (cause) => new AppleAuthError({ cause }),
    });

    const signature = yield* Effect.tryPromise({
      try: async () =>
        crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          key,
          new TextEncoder().encode(signingInput),
        ),
      catch: (cause) => new AppleAuthError({ cause }),
    });

    return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
  });

// ── Fetch helpers ──────────────────────────────────────────────────

const API_BASE = "https://api.appstoreconnect.apple.com";

const parseErrorMessage = (response: Response, body: unknown): AppleApiError => {
  const [first] = extractErrors(body);
  return new AppleApiError({
    status: response.status,
    message: first?.detail ?? first?.title ?? response.statusText,
    ...(first?.code ? { code: first.code } : {}),
  });
};

const fetchJson = (
  jwt: string,
  path: string,
  init?: { readonly method?: string; readonly body?: string },
) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () =>
        fetch(`${API_BASE}${path}`, {
          method: init?.method ?? "GET",
          ...(init?.body ? { body: init.body } : {}),
          headers: {
            authorization: `Bearer ${jwt}`,
            "content-type": "application/json",
            accept: "application/json",
          },
        }),
      catch: (cause) => new AppleNetworkError({ cause }),
    });

    const text = yield* Effect.tryPromise({
      try: async () => response.text(),
      catch: (cause) => new AppleNetworkError({ cause }),
    });

    const body: unknown = text ? JSON.parse(text) : {};
    if (!response.ok) {
      return yield* Effect.fail(parseErrorMessage(response, body));
    }
    return body;
  });

// ── Service ────────────────────────────────────────────────────────

export interface AppleAppStoreConnectService {
  readonly signJwt: (credentials: AppleCredentials) => Effect.Effect<string, AppleAuthError>;
  readonly listDevices: (
    credentials: AppleCredentials,
  ) => Effect.Effect<readonly AppleDevice[], AppleApiError | AppleAuthError | AppleNetworkError>;
  readonly registerDevice: (
    credentials: AppleCredentials,
    params: { readonly name: string; readonly udid: string; readonly platform: "IOS" | "MAC_OS" },
  ) => Effect.Effect<AppleDevice, AppleApiError | AppleAuthError | AppleNetworkError>;
  readonly listBundleIds: (
    credentials: AppleCredentials,
    opts?: { readonly jwt?: string },
  ) => Effect.Effect<readonly AppleBundleId[], AppleApiError | AppleAuthError | AppleNetworkError>;
  readonly createBundleId: (
    credentials: AppleCredentials,
    params: { readonly identifier: string; readonly name: string },
    opts?: { readonly jwt?: string },
  ) => Effect.Effect<AppleBundleId, AppleApiError | AppleAuthError | AppleNetworkError>;
  readonly listCertificates: (
    credentials: AppleCredentials,
    params: { readonly certificateType?: AppleCertificateType },
    opts?: { readonly jwt?: string },
  ) => Effect.Effect<
    readonly AppleCertificate[],
    AppleApiError | AppleAuthError | AppleNetworkError
  >;
  readonly generateProvisioningProfile: (
    credentials: AppleCredentials,
    params: {
      readonly profileName: string;
      readonly profileType: AppleProfileType;
      readonly bundleIdAscId: string;
      readonly certificateAscIds: readonly string[];
      readonly deviceAscIds: readonly string[];
    },
    opts?: { readonly jwt?: string },
  ) => Effect.Effect<AppleProfile, AppleApiError | AppleAuthError | AppleNetworkError>;
}

export class AppleAppStoreConnect extends Context.Tag("server/AppleAppStoreConnect")<
  AppleAppStoreConnect,
  AppleAppStoreConnectService
>() {}

const fetchDevicePage = (
  jwt: string,
  path: string,
): Effect.Effect<readonly AppleDevice[], AppleApiError | AppleNetworkError> =>
  Effect.gen(function* () {
    const body = yield* fetchJson(jwt, path);
    const { data, next } = extractDevicesPage(body);
    const current = data.map(mapDevice);
    if (next === null) {
      return current;
    }
    const remainder = yield* fetchDevicePage(jwt, next.replace(API_BASE, ""));
    return [...current, ...remainder];
  });

const listDevicesImpl = (credentials: AppleCredentials) =>
  Effect.gen(function* () {
    const jwt = yield* signJwt(credentials);
    return yield* fetchDevicePage(jwt, "/v1/devices?limit=200");
  });

const registerDeviceImpl = (
  credentials: AppleCredentials,
  params: { name: string; udid: string; platform: "IOS" | "MAC_OS" },
) =>
  Effect.gen(function* () {
    const jwt = yield* signJwt(credentials);
    const body = yield* fetchJson(jwt, "/v1/devices", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "devices",
          attributes: { name: params.name, udid: params.udid, platform: params.platform },
        },
      }),
    });
    const resource = extractDeviceSingle(body);
    if (resource === null) {
      return yield* Effect.fail(
        new AppleApiError({ status: 500, message: "Apple API returned malformed device response" }),
      );
    }
    return mapDevice(resource);
  });

const useJwt = (credentials: AppleCredentials, opts?: { jwt?: string }) =>
  opts?.jwt === undefined ? signJwt(credentials) : Effect.succeed(opts.jwt);

const listBundleIdsImpl = (credentials: AppleCredentials, opts?: { jwt?: string }) =>
  Effect.gen(function* () {
    const jwt = yield* useJwt(credentials, opts);
    const body = yield* fetchJson(jwt, "/v1/bundleIds?limit=200");
    return extractList(body, toBundleId);
  });

const createBundleIdImpl = (
  credentials: AppleCredentials,
  params: { identifier: string; name: string },
  opts?: { jwt?: string },
) =>
  Effect.gen(function* () {
    const jwt = yield* useJwt(credentials, opts);
    const body = yield* fetchJson(jwt, "/v1/bundleIds", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "bundleIds",
          attributes: { identifier: params.identifier, name: params.name, platform: "IOS" },
        },
      }),
    });
    const resource = extractSingle(body, toBundleId);
    if (resource === null) {
      return yield* Effect.fail(
        new AppleApiError({ status: 500, message: "Malformed bundleId response" }),
      );
    }
    return resource;
  });

const listCertificatesImpl = (
  credentials: AppleCredentials,
  params: { certificateType?: AppleCertificateType },
  opts?: { jwt?: string },
) =>
  Effect.gen(function* () {
    const jwt = yield* useJwt(credentials, opts);
    const filter = params.certificateType
      ? `?filter[certificateType]=${params.certificateType}&limit=200`
      : "?limit=200";
    const body = yield* fetchJson(jwt, `/v1/certificates${filter}`);
    return extractList(body, toCertificate);
  });

const generateProvisioningProfileImpl = (
  credentials: AppleCredentials,
  params: {
    profileName: string;
    profileType: AppleProfileType;
    bundleIdAscId: string;
    certificateAscIds: readonly string[];
    deviceAscIds: readonly string[];
  },
  opts?: { jwt?: string },
) =>
  Effect.gen(function* () {
    const jwt = yield* useJwt(credentials, opts);
    const relationships = {
      bundleId: { data: { type: "bundleIds", id: params.bundleIdAscId } },
      certificates: {
        data: params.certificateAscIds.map((id) => ({ type: "certificates", id })),
      },
      ...(params.deviceAscIds.length > 0
        ? { devices: { data: params.deviceAscIds.map((id) => ({ type: "devices", id })) } }
        : {}),
    };
    const body = yield* fetchJson(jwt, "/v1/profiles", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "profiles",
          attributes: { name: params.profileName, profileType: params.profileType },
          relationships,
        },
      }),
    });
    const resource = extractSingle(body, toProfile);
    if (resource === null) {
      return yield* Effect.fail(
        new AppleApiError({ status: 500, message: "Malformed profile response" }),
      );
    }
    return resource;
  });

export const AppleAppStoreConnectLive = Layer.succeed(AppleAppStoreConnect, {
  signJwt,
  listDevices: listDevicesImpl,
  registerDevice: registerDeviceImpl,
  listBundleIds: listBundleIdsImpl,
  createBundleId: createBundleIdImpl,
  listCertificates: listCertificatesImpl,
  generateProvisioningProfile: generateProvisioningProfileImpl,
});
