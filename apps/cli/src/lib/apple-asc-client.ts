/**
 * App Store Connect REST client authenticated with an ASC **API key** — a JWT
 * signed from a `.p8` private key (see `apple-asc-jwt.ts`). Credentials are
 * resolved non-interactively from the server (`fetchAscCredentials`), so this
 * powers headless flows: build-credential resolution, provisioning-profile
 * generation, and device sync.
 *
 * Intentionally NOT built on `@expo/apple-utils`: that library authenticates
 * via an interactive Apple-ID **cookie session** (username/password + 2FA, see
 * `services/apple-auth.ts`) and exposes a cookie-based `RequestContext`. That is
 * a different auth model that would force an interactive login here. The two
 * coexist by design — apple-utils backs `apple login`; this client backs
 * non-interactive ASC API-key access.
 */
import { compact, isRecord } from "@better-update/type-guards";
import { Data, Effect } from "effect";

import { signAscJwt } from "./apple-asc-jwt";

import type { AppleAuthError, AscCredentials } from "./apple-asc-jwt";

export type { AppleAuthError, AscCredentials } from "./apple-asc-jwt";

export type AscCertificateType =
  | "DEVELOPMENT"
  | "DISTRIBUTION"
  | "IOS_DEVELOPMENT"
  | "IOS_DISTRIBUTION";

export type AscProfileType =
  | "IOS_APP_ADHOC"
  | "IOS_APP_DEVELOPMENT"
  | "IOS_APP_STORE"
  | "IOS_APP_INHOUSE";

export interface AscCertificate {
  readonly id: string;
  readonly serialNumber: string;
  readonly certificateType: string;
  readonly displayName: string | null;
  readonly certificateContent: string | null;
  readonly expirationDate: string;
}

export interface AscBundleId {
  readonly id: string;
  readonly identifier: string;
  readonly name: string;
}

export interface AscProfile {
  readonly id: string;
  readonly name: string;
  readonly uuid: string;
  readonly profileType: AscProfileType;
  readonly expirationDate: string;
  readonly profileContent: string;
}

export interface AscDevice {
  readonly id: string;
  readonly udid: string;
  readonly name: string;
}

export class AscApiError extends Data.TaggedError("AscApiError")<{
  readonly status: number;
  readonly message: string;
  readonly code: string | undefined;
  readonly raw: string;
}> {}

export class AscNetworkError extends Data.TaggedError("AscNetworkError")<{
  readonly cause: unknown;
}> {}

export type AscError = AppleAuthError | AscApiError | AscNetworkError;

const API_BASE = "https://api.appstoreconnect.apple.com";

interface ErrorBody {
  readonly status?: string;
  readonly code?: string;
  readonly title?: string;
  readonly detail?: string;
}

const extractErrors = (body: unknown): readonly ErrorBody[] => {
  if (!isRecord(body) || !Array.isArray(body["errors"])) {
    return [];
  }
  return body["errors"].filter((value): value is ErrorBody => isRecord(value));
};

const parseApiError = (response: Response, body: unknown, raw: string): AscApiError => {
  const [first] = extractErrors(body);
  return new AscApiError({
    status: response.status,
    message: first?.detail ?? first?.title ?? response.statusText,
    code: first?.code,
    raw,
  });
};

const fetchRaw = (jwt: string, path: string, init?: { method?: string; body?: string }) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () =>
        fetch(
          `${API_BASE}${path}`,
          compact({
            method: init?.method ?? "GET",
            body: init?.body,
            headers: {
              authorization: `Bearer ${jwt}`,
              "content-type": "application/json",
              accept: "application/json",
            },
          }),
        ),
      catch: (cause) => new AscNetworkError({ cause }),
    });
    const text = yield* Effect.tryPromise({
      try: async () => response.text(),
      catch: (cause) => new AscNetworkError({ cause }),
    });
    const body = yield* Effect.try({
      try: (): unknown => (text.length === 0 ? {} : JSON.parse(text)),
      catch: (cause) => new AscNetworkError({ cause }),
    });
    if (!response.ok) {
      return yield* parseApiError(response, body, text);
    }
    return body;
  });

const toAscCertificate = (value: unknown): AscCertificate | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { serialNumber, certificateType, expirationDate, certificateContent, displayName } =
    attributes;
  if (
    typeof serialNumber !== "string" ||
    typeof certificateType !== "string" ||
    typeof expirationDate !== "string"
  ) {
    return null;
  }
  return {
    id,
    serialNumber,
    certificateType,
    expirationDate,
    certificateContent: typeof certificateContent === "string" ? certificateContent : null,
    displayName: typeof displayName === "string" ? displayName : null,
  };
};

const toAscBundleId = (value: unknown): AscBundleId | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { identifier, name } = attributes;
  if (typeof identifier !== "string" || typeof name !== "string") {
    return null;
  }
  return { id, identifier, name };
};

const PROFILE_TYPES: readonly AscProfileType[] = [
  "IOS_APP_ADHOC",
  "IOS_APP_DEVELOPMENT",
  "IOS_APP_STORE",
  "IOS_APP_INHOUSE",
];

const asProfileType = (value: unknown): AscProfileType | null => {
  const match = PROFILE_TYPES.find((entry) => entry === value);
  return match === undefined ? null : match;
};

const toAscProfile = (value: unknown): AscProfile | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { name, uuid, expirationDate, profileContent } = attributes;
  const profileType = asProfileType(attributes["profileType"]);
  if (
    typeof name !== "string" ||
    typeof uuid !== "string" ||
    typeof expirationDate !== "string" ||
    typeof profileContent !== "string" ||
    profileType === null
  ) {
    return null;
  }
  return { id, name, uuid, expirationDate, profileContent, profileType };
};

const toAscDevice = (value: unknown): AscDevice | null => {
  if (!isRecord(value)) {
    return null;
  }
  const { id, attributes } = value;
  if (typeof id !== "string" || !isRecord(attributes)) {
    return null;
  }
  const { udid, name } = attributes;
  if (typeof udid !== "string" || typeof name !== "string") {
    return null;
  }
  return { id, udid, name };
};

const extractList = <T>(body: unknown, map: (value: unknown) => T | null): readonly T[] => {
  if (!isRecord(body) || !Array.isArray(body["data"])) {
    return [];
  }
  return body["data"].map(map).filter((value): value is T => value !== null);
};

const extractSingle = <T>(body: unknown, map: (value: unknown) => T | null): T | null => {
  if (!isRecord(body)) {
    return null;
  }
  return map(body["data"]);
};

const malformed = (resource: string): AscApiError =>
  new AscApiError({
    status: 500,
    message: `Malformed ${resource} response`,
    code: undefined,
    raw: "",
  });

const withJwt = <Value, Err, Req>(
  credentials: AscCredentials,
  fn: (jwt: string) => Effect.Effect<Value, Err, Req>,
) =>
  Effect.gen(function* () {
    const jwt = yield* signAscJwt(credentials);
    return yield* fn(jwt);
  });

export const listCertificates = (
  credentials: AscCredentials,
  params?: { readonly certificateType?: AscCertificateType },
) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const filter = params?.certificateType
        ? `?filter[certificateType]=${params.certificateType}&limit=200`
        : "?limit=200";
      const body = yield* fetchRaw(jwt, `/v1/certificates${filter}`);
      return extractList(body, toAscCertificate);
    }),
  );

export const createCertificate = (
  credentials: AscCredentials,
  params: { readonly csrPem: string; readonly certificateType: AscCertificateType },
) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const csrContent = params.csrPem
        .replaceAll("-----BEGIN CERTIFICATE REQUEST-----", "")
        .replaceAll("-----END CERTIFICATE REQUEST-----", "")
        .replaceAll(/\s+/gu, "");
      const body = yield* fetchRaw(jwt, "/v1/certificates", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "certificates",
            attributes: { csrContent, certificateType: params.certificateType },
          },
        }),
      });
      const resource = extractSingle(body, toAscCertificate);
      if (resource === null) {
        return yield* malformed("certificate");
      }
      return resource;
    }),
  );

export const deleteCertificate = (credentials: AscCredentials, id: string) =>
  withJwt(credentials, (jwt) =>
    Effect.asVoid(
      fetchRaw(jwt, `/v1/certificates/${encodeURIComponent(id)}`, { method: "DELETE" }),
    ),
  );

export const listBundleIds = (credentials: AscCredentials) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const body = yield* fetchRaw(jwt, "/v1/bundleIds?limit=200");
      return extractList(body, toAscBundleId);
    }),
  );

export const createBundleId = (
  credentials: AscCredentials,
  params: { readonly identifier: string; readonly name: string },
) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const body = yield* fetchRaw(jwt, "/v1/bundleIds", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "bundleIds",
            attributes: { identifier: params.identifier, name: params.name, platform: "IOS" },
          },
        }),
      });
      const resource = extractSingle(body, toAscBundleId);
      if (resource === null) {
        return yield* malformed("bundleId");
      }
      return resource;
    }),
  );

export const listDevices = (credentials: AscCredentials) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const body = yield* fetchRaw(jwt, "/v1/devices?limit=200");
      return extractList(body, toAscDevice);
    }),
  );

export const createProvisioningProfile = (
  credentials: AscCredentials,
  params: {
    readonly profileName: string;
    readonly profileType: AscProfileType;
    readonly bundleIdAscId: string;
    readonly certificateAscIds: readonly string[];
    readonly deviceAscIds: readonly string[];
  },
) =>
  withJwt(credentials, (jwt) =>
    Effect.gen(function* () {
      const relationships = {
        bundleId: { data: { type: "bundleIds", id: params.bundleIdAscId } },
        certificates: {
          data: params.certificateAscIds.map((id) => ({ type: "certificates", id })),
        },
        ...(params.deviceAscIds.length > 0
          ? { devices: { data: params.deviceAscIds.map((id) => ({ type: "devices", id })) } }
          : {}),
      };
      const body = yield* fetchRaw(jwt, "/v1/profiles", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "profiles",
            attributes: { name: params.profileName, profileType: params.profileType },
            relationships,
          },
        }),
      });
      const resource = extractSingle(body, toAscProfile);
      if (resource === null) {
        return yield* malformed("profile");
      }
      return resource;
    }),
  );

export const isCertificateLimitError = (error: AscError): boolean => {
  if (error._tag !== "AscApiError") {
    return false;
  }
  return /already have a current.*certificate|pending certificate request/iu.test(error.message);
};
