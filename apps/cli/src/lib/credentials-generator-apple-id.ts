import { fromBase64, toBase64 } from "@better-update/encoding";
import { compact, toOptional } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
// @expo/apple-utils is ncc-bundled CJS; `import * as` only surfaces `default`/`module.exports`
// via Node ESM's cjs-module-lexer, so the entity managers + enums (Certificate, BundleId,
// Profile, Device, ProfileType, CertificateType, Keys, ...) are read off the default import.
import AppleUtils from "@expo/apple-utils";
import { Data, Effect } from "effect";

import {
  openVaultSessionInteractive,
  sealForUpload,
  toUploadEnvelope,
} from "../application/credential-cipher";
import { extractMetadataFromP12 } from "./apple-cert-to-p12";
import { CertificateLimitError, computeDeviceRosterHashHex } from "./credentials-generator";

import type { ApiClient } from "../services/api-client";

type DistributionType = "APP_STORE" | "AD_HOC" | "DEVELOPMENT" | "ENTERPRISE";

const DISTRIBUTION_TO_PROFILE_TYPE: Record<DistributionType, AppleUtils.ProfileType> = {
  APP_STORE: AppleUtils.ProfileType.IOS_APP_STORE,
  AD_HOC: AppleUtils.ProfileType.IOS_APP_ADHOC,
  DEVELOPMENT: AppleUtils.ProfileType.IOS_APP_DEVELOPMENT,
  ENTERPRISE: AppleUtils.ProfileType.IOS_APP_INHOUSE,
};

const DISTRIBUTION_TO_CERTIFICATE_TYPE: Record<DistributionType, AppleUtils.CertificateType> = {
  APP_STORE: AppleUtils.CertificateType.IOS_DISTRIBUTION,
  AD_HOC: AppleUtils.CertificateType.IOS_DISTRIBUTION,
  ENTERPRISE: AppleUtils.CertificateType.IOS_DISTRIBUTION,
  DEVELOPMENT: AppleUtils.CertificateType.IOS_DEVELOPMENT,
};

export class AppleIdGenerateFailedError extends Data.TaggedError("AppleIdGenerateFailedError")<{
  readonly step: string;
  readonly message: string;
}> {}

// Apple caps a team at two APNs auth keys. apple-utils throws MaxKeysCreatedError
// when the create would exceed that; we surface it as a dedicated tag so the
// command layer can offer an interactive revoke-and-retry (mirrors CertificateLimitError).
export class ApnsKeyLimitError extends Data.TaggedError("ApnsKeyLimitError")<{
  readonly message: string;
}> {}

// Mirrors apple-asc-client.isCertificateLimitError — Apple's portal returns the same wording
// regardless of whether the request originated from an ASC API call or the Apple ID session.
const CERT_LIMIT_PATTERN = /already have a current.*certificate|pending certificate request/iu;

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const wrap = <T>(step: string, run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new AppleIdGenerateFailedError({ step, message: messageOf(cause) }),
  });

const wrapCertificateCreate = <T>(run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => {
      const message = messageOf(cause);
      if (CERT_LIMIT_PATTERN.test(message)) {
        return new CertificateLimitError({ message });
      }
      return new AppleIdGenerateFailedError({ step: "apple-create-certificate", message });
    },
  });

export interface GenerateCertificateViaAppleIdInput {
  readonly context: AppleUtils.RequestContext;
  readonly certificateType?: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT";
}

export const generateAndUploadDistributionCertificateViaAppleId = (
  api: ApiClient,
  input: GenerateCertificateViaAppleIdInput,
) =>
  Effect.gen(function* () {
    const ctx = input.context;
    const certificateType =
      input.certificateType === "IOS_DEVELOPMENT"
        ? AppleUtils.CertificateType.IOS_DEVELOPMENT
        : AppleUtils.CertificateType.IOS_DISTRIBUTION;

    const result = yield* wrapCertificateCreate(async () =>
      AppleUtils.createCertificateAndP12Async(ctx, { certificateType }),
    );

    const metadata = yield* extractMetadataFromP12({
      p12Base64: result.certificateP12,
      password: result.password,
    }).pipe(
      Effect.mapError(
        (cause) => new AppleIdGenerateFailedError({ step: "parse-p12", message: cause.message }),
      ),
    );

    const session = yield* openVaultSessionInteractive(api);
    const envelopeMetadata = {
      serialNumber: metadata.serialNumber,
      appleTeamIdentifier: metadata.appleTeamId,
      validFrom: metadata.validFrom,
      validUntil: metadata.validUntil,
    };
    const envelope = yield* sealForUpload({
      session,
      credentialType: "distribution-certificate",
      metadata: envelopeMetadata,
      secret: { p12Base64: result.certificateP12, p12Password: result.password },
    }).pipe(
      Effect.mapError(
        (cause) => new AppleIdGenerateFailedError({ step: "encrypt-p12", message: cause.message }),
      ),
    );

    const created = yield* api.appleDistributionCertificates.upload({
      payload: {
        ...toUploadEnvelope(envelope),
        ...envelopeMetadata,
        ...compact({
          appleTeamName: toOptional(metadata.appleTeamName),
          developerIdIdentifier: toOptional(metadata.developerIdIdentifier),
        }),
      },
    });

    return {
      id: created.id,
      serialNumber: metadata.serialNumber,
      appleTeamId: created.appleTeamId,
      appleTeamIdentifier: metadata.appleTeamId,
      developerPortalIdentifier: result.certificate.id,
    };
  });

export interface AppleIdDistributionCertificateSummary {
  readonly developerPortalIdentifier: string;
  readonly serialNumber: string;
  readonly displayName: string;
  readonly expirationDate: string;
}

export const listDistributionCertsViaAppleId = (
  ctx: AppleUtils.RequestContext,
  certificateType: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT" = "IOS_DISTRIBUTION",
) =>
  Effect.gen(function* () {
    const filter =
      certificateType === "IOS_DEVELOPMENT"
        ? AppleUtils.CertificateType.IOS_DEVELOPMENT
        : AppleUtils.CertificateType.IOS_DISTRIBUTION;
    const certs = yield* wrap("apple-list-certificates", async () =>
      AppleUtils.Certificate.getAsync(ctx, { query: { filter: { certificateType: filter } } }),
    );
    return certs.map(
      (entry) =>
        ({
          developerPortalIdentifier: entry.id,
          serialNumber: entry.attributes.serialNumber,
          displayName: entry.attributes.displayName,
          expirationDate: entry.attributes.expirationDate,
        }) satisfies AppleIdDistributionCertificateSummary,
    );
  });

export const revokeDistributionCertViaAppleId = (
  ctx: AppleUtils.RequestContext,
  developerPortalIdentifier: string,
) =>
  wrap("apple-revoke-certificate", async () =>
    AppleUtils.Certificate.deleteAsync(ctx, { id: developerPortalIdentifier }),
  );

const findOrCreateBundleId = (ctx: AppleUtils.RequestContext, bundleIdentifier: string) =>
  Effect.gen(function* () {
    const existing = yield* wrap("apple-find-bundle-id", async () =>
      AppleUtils.BundleId.findAsync(ctx, { identifier: bundleIdentifier }),
    );
    if (existing !== null) {
      return existing.id;
    }
    const created = yield* wrap("apple-create-bundle-id", async () =>
      AppleUtils.BundleId.createAsync(ctx, {
        identifier: bundleIdentifier,
        name: bundleIdentifier,
        platform: AppleUtils.BundleIdPlatform.IOS,
      }),
    );
    return created.id;
  });

const findAscCertificateId = (
  ctx: AppleUtils.RequestContext,
  serialNumber: string,
  certificateType: AppleUtils.CertificateType,
) =>
  Effect.gen(function* () {
    const certs = yield* wrap("apple-list-certificates", async () =>
      AppleUtils.Certificate.getAsync(ctx, {
        query: { filter: { certificateType } },
      }),
    );
    const upper = serialNumber.toUpperCase();
    const match = certs.find((entry) => entry.attributes.serialNumber.toUpperCase() === upper);
    if (match === undefined) {
      return yield* new AppleIdGenerateFailedError({
        step: "match-apple-certificate",
        message: `Distribution certificate ${serialNumber} not present on Apple Developer Portal; upload or re-generate it`,
      });
    }
    return match.id;
  });

const collectIosDeviceIds = (
  ctx: AppleUtils.RequestContext,
  deviceIds: readonly string[] | undefined,
) =>
  Effect.gen(function* () {
    const devices = yield* wrap("apple-list-devices", async () =>
      AppleUtils.Device.getAllIOSProfileDevicesAsync(ctx),
    );
    if (deviceIds === undefined) {
      return devices.map((device) => device.id);
    }
    const allowed = new Set(deviceIds);
    return devices.filter((device) => allowed.has(device.id)).map((device) => device.id);
  });

export interface GenerateProvisioningProfileViaAppleIdInput {
  readonly context: AppleUtils.RequestContext;
  readonly distributionCertificateId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly deviceIds?: readonly string[];
}

export const generateAndUploadProvisioningProfileViaAppleId = (
  api: ApiClient,
  input: GenerateProvisioningProfileViaAppleIdInput,
) =>
  Effect.gen(function* () {
    const ctx = input.context;

    const cert = yield* api.appleDistributionCertificates.list().pipe(
      Effect.map(({ items }) => items.find((item) => item.id === input.distributionCertificateId)),
      Effect.flatMap((match) =>
        match === undefined
          ? Effect.fail(
              new AppleIdGenerateFailedError({
                step: "load-distribution-certificate",
                message: `Distribution certificate ${input.distributionCertificateId} not found`,
              }),
            )
          : Effect.succeed(match),
      ),
    );

    const certificateType = DISTRIBUTION_TO_CERTIFICATE_TYPE[input.distributionType];

    const [certAscId, bundleIdAscId] = yield* Effect.all(
      [
        findAscCertificateId(ctx, cert.serialNumber, certificateType),
        findOrCreateBundleId(ctx, input.bundleIdentifier),
      ],
      { concurrency: 2 },
    );

    const useDevices =
      input.distributionType === "AD_HOC" || input.distributionType === "DEVELOPMENT";
    const deviceIds = useDevices ? yield* collectIosDeviceIds(ctx, input.deviceIds) : [];

    if (useDevices && deviceIds.length === 0) {
      return yield* new AppleIdGenerateFailedError({
        step: "collect-devices",
        message: "No registered devices to attach to the provisioning profile",
      });
    }

    const profileName = `${input.bundleIdentifier} ${input.distributionType} ${Date.now()}`;
    const profile = yield* wrap("apple-create-profile", async () =>
      AppleUtils.Profile.createAsync(ctx, {
        bundleId: bundleIdAscId,
        certificates: [certAscId],
        devices: deviceIds,
        name: profileName,
        profileType: DISTRIBUTION_TO_PROFILE_TYPE[input.distributionType],
      }),
    );

    const { profileContent } = profile.attributes;
    if (profileContent === null) {
      return yield* new AppleIdGenerateFailedError({
        step: "extract-profile-content",
        message: "Apple returned a profile with no content (likely expired/invalid)",
      });
    }
    const profileBytes = fromBase64(profileContent);
    const rosterHash = useDevices ? computeDeviceRosterHashHex(deviceIds) : undefined;

    const created = yield* api.appleProvisioningProfiles.upload({
      payload: {
        profileBase64: toBase64(profileBytes),
        appleDistributionCertificateId: input.distributionCertificateId,
        isManaged: true,
        ...compact({ deviceRosterHash: rosterHash }),
      },
    });

    return {
      id: created.id,
      bundleIdentifier: created.bundleIdentifier,
      distributionType: created.distributionType,
      profileName: created.profileName,
      validUntil: created.validUntil,
      developerPortalIdentifier: created.developerPortalIdentifier,
    };
  });

// ── APNs push keys (.p8) via Apple ID ─────────────────────────────
// Apple does not expose APNs key creation on the public ASC REST API — only the
// Developer Portal session (the same Apple ID cookie session used above for
// certs/profiles). apple-utils' `Keys` manager wraps those portal endpoints.

// Apple Push Notification service config id (Keys.AppStoreKeyServiceConfigID.APNS).
// Hardcoded so the APNs filter does not depend on the enum surviving the CJS bundle.
const APNS_SERVICE_ID = "U27F4V844T";

// At the per-team cap, Apple's portal returns a plain server error ("…maximum
// allowed number of team scoped Keys…") — apple-utils does NOT wrap it as a typed
// MaxKeysCreatedError in this path (verified live), so match the wording too,
// mirroring CERT_LIMIT_PATTERN. Without this the revoke-and-retry never triggers.
const APNS_KEY_LIMIT_PATTERN = /maximum allowed number of .*keys/iu;

const wrapKeyCreate = <T>(run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => {
      const message = messageOf(cause);
      return cause instanceof AppleUtils.Keys.MaxKeysCreatedError ||
        APNS_KEY_LIMIT_PATTERN.test(message)
        ? new ApnsKeyLimitError({ message })
        : new AppleIdGenerateFailedError({ step: "apple-create-key", message });
    },
  });

// Best-effort rescue: persist the one-shot .p8 next to the user so a created-but-
// unstored key is recoverable. Apple only lets a key be downloaded once, so once
// the in-memory copy is gone the key is dead weight occupying a team slot.
const writeRescueP8 = (keyId: string, p8Pem: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = `AuthKey_${keyId}.p8`;
    yield* fs.writeFileString(filePath, p8Pem, { mode: 0o600 });
    return filePath;
  });

export interface GenerateApnsKeyViaAppleIdInput {
  readonly context: AppleUtils.RequestContext;
  readonly appleTeamIdentifier: string;
  readonly name: string;
}

export const generateAndUploadApnsKeyViaAppleId = (
  api: ApiClient,
  input: GenerateApnsKeyViaAppleIdInput,
) =>
  Effect.gen(function* () {
    const ctx = input.context;

    const key = yield* wrapKeyCreate(async () =>
      AppleUtils.Keys.createKeyAsync(ctx, { name: input.name, isApns: true }),
    );

    // Download immediately — Apple burns `canDownload` after the first fetch.
    const p8Pem = yield* wrap("apple-download-key", async () =>
      AppleUtils.Keys.downloadKeyAsync(ctx, { id: key.id }),
    );

    const metadata = { keyId: key.id, appleTeamIdentifier: input.appleTeamIdentifier };

    const persist = Effect.gen(function* () {
      const session = yield* openVaultSessionInteractive(api);
      const envelope = yield* sealForUpload({
        session,
        credentialType: "push-key",
        metadata,
        secret: { p8Pem },
      });
      return yield* api.applePushKeys.upload({
        payload: { ...toUploadEnvelope(envelope), ...metadata },
      });
    });

    // Anything after the one-shot download (vault unlock, seal, upload) failing
    // leaves an orphaned key on Apple that can never be re-downloaded. Rescue the
    // .p8 to disk and tell the user how to re-import it instead of losing it.
    const created = yield* persist.pipe(
      Effect.catchAll((cause) =>
        Effect.gen(function* () {
          const rescuePath = yield* writeRescueP8(key.id, p8Pem).pipe(
            Effect.catchAll(() => Effect.succeed(null)),
          );
          const where =
            rescuePath === null
              ? "could not be saved locally and is now unrecoverable"
              : `was saved to ${rescuePath} — re-import with \`credentials generate push-key --p8 ${rescuePath} --key-id ${key.id} --apple-team-id ${input.appleTeamIdentifier}\``;
          return yield* new AppleIdGenerateFailedError({
            step: "store-apns-key",
            message: `Created APNs key ${key.id} on Apple but failed to store it (${messageOf(cause)}). The downloaded .p8 ${where}.`,
          });
        }),
      ),
    );

    return {
      id: created.id,
      keyId: key.id,
      appleTeamIdentifier: input.appleTeamIdentifier,
      name: key.name,
    };
  });

export interface AppleIdApnsKeySummary {
  readonly developerPortalKeyId: string;
  readonly name: string;
  readonly canRevoke: boolean;
}

// List the team's APNs auth keys (filtered out of all portal keys — DeviceCheck,
// MusicKit, SIWA also live here). Used by the create-limit recovery + revoke picker.
export const listApnsKeysViaAppleId = (ctx: AppleUtils.RequestContext) =>
  Effect.gen(function* () {
    const keys = yield* wrap("apple-list-keys", async () => AppleUtils.Keys.getKeysAsync(ctx));
    // `services` is only populated by getKeyInfoAsync, so fetch detail per key.
    const detailed = yield* Effect.forEach(
      keys,
      (key) =>
        wrap("apple-get-key-info", async () =>
          AppleUtils.Keys.getKeyInfoAsync(ctx, { id: key.id }),
        ),
      { concurrency: 4 },
    );
    return detailed
      .filter((info) => info.services.some((service) => service.id === APNS_SERVICE_ID))
      .map(
        (info) =>
          ({
            developerPortalKeyId: info.id,
            name: info.name,
            canRevoke: info.canRevoke,
          }) satisfies AppleIdApnsKeySummary,
      );
  });

export const revokeApnsKeyViaAppleId = (
  ctx: AppleUtils.RequestContext,
  developerPortalKeyId: string,
) =>
  wrap("apple-revoke-key", async () =>
    AppleUtils.Keys.revokeKeyAsync(ctx, { id: developerPortalKeyId }),
  );

export interface RevokeLocalApnsKeyInput {
  readonly context: AppleUtils.RequestContext;
  /** Local server-row id of the stored push key. */
  readonly pushKeyId: string;
  /** Apple Developer Portal key id (the `.p8` key id) to revoke upstream. */
  readonly keyId: string;
  /** Revoke on Apple but keep the stored credential. */
  readonly keepLocal: boolean;
}

/**
 * Revoke an APNs key on Apple and (optionally) delete the stored copy. Only keys
 * still present on the portal are revoked — one already gone upstream is treated
 * as `revokedOnApple: false` and still deleted locally, so cleanup never wedges.
 * Shared by the `revoke push-key` command and the interactive wizard.
 */
export const revokeLocalApnsKey = (api: ApiClient, input: RevokeLocalApnsKeyInput) =>
  Effect.gen(function* () {
    const remoteKeys = yield* listApnsKeysViaAppleId(input.context);
    const present = remoteKeys.some((entry) => entry.developerPortalKeyId === input.keyId);
    if (present) {
      yield* revokeApnsKeyViaAppleId(input.context, input.keyId);
    }
    if (!input.keepLocal) {
      yield* api.applePushKeys.delete({ path: { id: input.pushKeyId } });
    }
    return {
      localId: input.pushKeyId,
      keyId: input.keyId,
      revokedOnApple: present,
      deletedLocally: !input.keepLocal,
    };
  });
