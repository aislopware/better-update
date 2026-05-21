import { toBase64 } from "@better-update/encoding";
import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect, Match } from "effect";

import {
  openVaultSession,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { resolveVaultPassphrase } from "../application/vault-access";
import { parseGoogleServiceAccountKey, validateAndroidKeystore } from "./credential-metadata";
import { CredentialValidationError } from "./exit-codes";
import { inspectP12 } from "./pkcs12";

import type { ApiClient } from "../services/api-client";

export type CliCredentialType =
  | "distribution-certificate"
  | "push-key"
  | "asc-api-key"
  | "provisioning-profile"
  | "keystore"
  | "google-service-account-key";

export type CliCredentialPlatform = "ios" | "android";

export interface CliCredentialRow {
  readonly id: string;
  readonly name: string;
  readonly platform: CliCredentialPlatform;
  readonly type: CliCredentialType;
  readonly distribution: string | null;
}

const formatDistribution = (value: string): string => value.toLowerCase().replaceAll("_", "-");

export const listAllCredentials = (api: ApiClient) =>
  Effect.gen(function* () {
    const [certs, pushKeys, ascKeys, profiles, keystores, googleKeys] = yield* Effect.all(
      [
        api.appleDistributionCertificates.list(),
        api.applePushKeys.list(),
        api.ascApiKeys.list(),
        api.appleProvisioningProfiles.list({ urlParams: {} }),
        api.androidUploadKeystores.list(),
        api.googleServiceAccountKeys.list(),
      ],
      { concurrency: "unbounded" },
    );

    const rows: CliCredentialRow[] = [
      ...certs.items.map(
        (cert): CliCredentialRow => ({
          id: cert.id,
          name: cert.serialNumber,
          platform: "ios",
          type: "distribution-certificate",
          distribution: null,
        }),
      ),
      ...pushKeys.items.map(
        (key): CliCredentialRow => ({
          id: key.id,
          name: key.keyId,
          platform: "ios",
          type: "push-key",
          distribution: null,
        }),
      ),
      ...ascKeys.items.map(
        (key): CliCredentialRow => ({
          id: key.id,
          name: key.name,
          platform: "ios",
          type: "asc-api-key",
          distribution: null,
        }),
      ),
      ...profiles.items.map(
        (profile): CliCredentialRow => ({
          id: profile.id,
          name: profile.profileName ?? profile.bundleIdentifier,
          platform: "ios",
          type: "provisioning-profile",
          distribution: formatDistribution(profile.distributionType),
        }),
      ),
      ...keystores.items.map(
        (ks): CliCredentialRow => ({
          id: ks.id,
          name: ks.keyAlias,
          platform: "android",
          type: "keystore",
          distribution: null,
        }),
      ),
      ...googleKeys.items.map(
        (key): CliCredentialRow => ({
          id: key.id,
          name: key.clientEmail,
          platform: "android",
          type: "google-service-account-key",
          distribution: null,
        }),
      ),
    ];

    return rows;
  });

export const filterCredentials = (
  rows: readonly CliCredentialRow[],
  filter: {
    readonly platform?: CliCredentialPlatform;
    readonly type?: CliCredentialType;
    readonly distribution?: string;
  },
): CliCredentialRow[] =>
  rows.filter((row) => {
    if (filter.platform && row.platform !== filter.platform) {
      return false;
    }
    if (filter.type && row.type !== filter.type) {
      return false;
    }
    if (filter.distribution && row.distribution !== filter.distribution) {
      return false;
    }
    return true;
  });

export interface UploadCredentialInput {
  readonly platform: CliCredentialPlatform;
  readonly type: CliCredentialType;
  readonly name: string;
  readonly filePath: string;
  readonly password?: string;
  readonly distribution?: string;
  readonly keyAlias?: string;
  readonly keyPassword?: string;
  readonly keyId?: string;
  readonly issuerId?: string;
  readonly appleTeamIdentifier?: string;
  /** Passphrase to unlock the device identity; undefined when using the CI env key. */
  readonly passphrase?: string;
}

const toUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const missing = (label: string) =>
  new CredentialValidationError({
    message: `Missing --${label} required for the selected credential type.`,
  });

const uploadIosDistributionCertificate = (
  api: ApiClient,
  input: UploadCredentialInput,
  bytes: Uint8Array,
) =>
  Effect.gen(function* () {
    if (input.password === undefined) {
      return yield* missing("password");
    }
    const info = yield* inspectP12({ data: Buffer.from(bytes), password: input.password });
    if (!info.teamId) {
      return yield* new CredentialValidationError({
        message:
          "Could not derive Apple Team ID from certificate subject (expected OU=TEAMID or CN with (TEAMID)).",
      });
    }
    if (!info.validFrom || !info.expiresAt) {
      return yield* new CredentialValidationError({
        message: "Certificate is missing notBefore/notAfter dates.",
      });
    }
    const metadata = {
      serialNumber: info.serialNumber,
      appleTeamIdentifier: info.teamId,
      validFrom: info.validFrom.toISOString(),
      validUntil: info.expiresAt.toISOString(),
    };
    const session = yield* openVaultSession(api, input.passphrase);
    const envelope = yield* sealForUpload({
      session,
      credentialType: "distribution-certificate",
      metadata,
      secret: { p12Base64: toBase64(bytes), p12Password: input.password },
    });
    const created = yield* api.appleDistributionCertificates.upload({
      payload: { ...toUploadEnvelope(envelope), ...metadata },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "ios" as const,
      type: "distribution-certificate" as const,
    };
  });

const uploadIosPushKey = (api: ApiClient, input: UploadCredentialInput, bytes: Uint8Array) =>
  Effect.gen(function* () {
    if (!input.keyId) {
      return yield* missing("key-id");
    }
    if (!input.appleTeamIdentifier) {
      return yield* missing("apple-team-identifier");
    }
    const metadata = { keyId: input.keyId, appleTeamIdentifier: input.appleTeamIdentifier };
    const session = yield* openVaultSession(api, input.passphrase);
    const envelope = yield* sealForUpload({
      session,
      credentialType: "push-key",
      metadata,
      secret: { p8Pem: toUtf8(bytes) },
    });
    const created = yield* api.applePushKeys.upload({
      payload: { ...toUploadEnvelope(envelope), ...metadata },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "ios" as const,
      type: "push-key" as const,
    };
  });

const uploadIosAscApiKey = (api: ApiClient, input: UploadCredentialInput, bytes: Uint8Array) =>
  Effect.gen(function* () {
    if (!input.keyId) {
      return yield* missing("key-id");
    }
    if (!input.issuerId) {
      return yield* missing("issuer-id");
    }
    const metadata = compact({
      name: input.name,
      keyId: input.keyId,
      issuerId: input.issuerId,
      appleTeamIdentifier: input.appleTeamIdentifier,
    });
    const session = yield* openVaultSession(api, input.passphrase);
    const envelope = yield* sealForUpload({
      session,
      credentialType: "asc-api-key",
      metadata,
      secret: { p8Pem: toUtf8(bytes) },
    });
    const created = yield* api.ascApiKeys.upload({
      payload: { ...toUploadEnvelope(envelope), ...metadata },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "ios" as const,
      type: "asc-api-key" as const,
    };
  });

const uploadIosProvisioningProfile = (
  api: ApiClient,
  input: UploadCredentialInput,
  bytes: Uint8Array,
) =>
  Effect.gen(function* () {
    const created = yield* api.appleProvisioningProfiles.upload({
      payload: { profileBase64: toBase64(bytes) },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "ios" as const,
      type: "provisioning-profile" as const,
    };
  });

const uploadAndroidKeystore = (api: ApiClient, input: UploadCredentialInput, bytes: Uint8Array) =>
  Effect.gen(function* () {
    if (input.password === undefined) {
      return yield* missing("password");
    }
    if (!input.keyAlias) {
      return yield* missing("key-alias");
    }
    if (!input.keyPassword) {
      return yield* missing("key-password");
    }
    const parsed = yield* validateAndroidKeystore({
      bytes,
      keyAlias: input.keyAlias,
      keystorePassword: input.password,
      keyPassword: input.keyPassword,
    });
    const metadata = { keyAlias: parsed.keyAlias };
    const session = yield* openVaultSession(api, input.passphrase);
    const envelope = yield* sealForUpload({
      session,
      credentialType: "keystore",
      metadata,
      secret: {
        keystoreBase64: toBase64(bytes),
        keystorePassword: input.password,
        keyPassword: input.keyPassword,
      },
    });
    const created = yield* api.androidUploadKeystores.upload({
      payload: { ...toUploadEnvelope(envelope), ...metadata },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "android" as const,
      type: "keystore" as const,
    };
  });

const uploadAndroidGoogleServiceAccountKey = (
  api: ApiClient,
  input: UploadCredentialInput,
  bytes: Uint8Array,
) =>
  Effect.gen(function* () {
    const json = toUtf8(bytes);
    const parsed = yield* parseGoogleServiceAccountKey(json);
    const metadata = {
      clientEmail: parsed.clientEmail,
      privateKeyId: parsed.privateKeyId,
      googleProjectId: parsed.googleProjectId,
    };
    const session = yield* openVaultSession(api, input.passphrase);
    const envelope = yield* sealForUpload({
      session,
      credentialType: "google-service-account-key",
      metadata,
      secret: { json },
    });
    const created = yield* api.googleServiceAccountKeys.upload({
      payload: { ...toUploadEnvelope(envelope), ...metadata },
    });
    return {
      id: created.id,
      name: input.name,
      platform: "android" as const,
      type: "google-service-account-key" as const,
    };
  });

const uploadHandlers = {
  "ios:distribution-certificate": uploadIosDistributionCertificate,
  "ios:push-key": uploadIosPushKey,
  "ios:asc-api-key": uploadIosAscApiKey,
  "ios:provisioning-profile": uploadIosProvisioningProfile,
  "android:keystore": uploadAndroidKeystore,
  "android:google-service-account-key": uploadAndroidGoogleServiceAccountKey,
};

export const uploadCredential = (api: ApiClient, input: UploadCredentialInput) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs.readFile(input.filePath);
    const key = `${input.platform}:${input.type}`;
    type HandlerKey = keyof typeof uploadHandlers;
    const hasKey = (candidate: string): candidate is HandlerKey =>
      Object.hasOwn(uploadHandlers, candidate);
    const handler = hasKey(key) ? uploadHandlers[key] : undefined;
    if (!handler) {
      return yield* new CredentialValidationError({
        message: `Unsupported credential combination: platform=${input.platform} type=${input.type}`,
      });
    }
    // Provisioning profiles are stored plaintext (not secret); everything else is
    // sealed, so resolve the unlock passphrase once here unless a caller passed one.
    const resolved: UploadCredentialInput =
      input.type === "provisioning-profile" || input.passphrase !== undefined
        ? input
        : { ...input, ...compact({ passphrase: yield* resolveVaultPassphrase }) };
    return yield* handler(api, resolved, bytes);
  });

export const deleteCredential = (
  api: ApiClient,
  input: {
    readonly id: string;
    readonly platform: CliCredentialPlatform;
    readonly type: CliCredentialType;
  },
) => {
  const path = { id: input.id };
  return Match.value({ platform: input.platform, type: input.type }).pipe(
    Match.when({ platform: "ios", type: "distribution-certificate" }, () =>
      api.appleDistributionCertificates.delete({ path }),
    ),
    Match.when({ platform: "ios", type: "push-key" }, () => api.applePushKeys.delete({ path })),
    Match.when({ platform: "ios", type: "asc-api-key" }, () => api.ascApiKeys.delete({ path })),
    Match.when({ platform: "ios", type: "provisioning-profile" }, () =>
      api.appleProvisioningProfiles.delete({ path }),
    ),
    Match.when({ platform: "android", type: "keystore" }, () =>
      api.androidUploadKeystores.delete({ path }),
    ),
    Match.when({ platform: "android", type: "google-service-account-key" }, () =>
      api.googleServiceAccountKeys.delete({ path }),
    ),
    Match.orElse(() =>
      Effect.fail(
        new CredentialValidationError({
          message: `Unsupported credential combination: platform=${input.platform} type=${input.type}`,
        }),
      ),
    ),
  );
};
