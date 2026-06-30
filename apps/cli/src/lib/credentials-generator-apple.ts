/**
 * iOS signing-credential generation on `@expo/apple-utils`, parameterized by the
 * App Store Connect `RequestContext`: a headless JWT `Token` context (built from a
 * vault `.p8` via {@link buildTokenRequestContext}) or an interactive Apple ID
 * cookie session (`AppleAuth.buildRequestContext`). Both drive the same entity
 * managers — apple-utils routes to the public ASC API or the developer portal by
 * which context is supplied. This is the single home for cert/bundle-id/device/
 * profile generation; the JWT REST client it replaced is gone.
 */
import { fromBase64, toBase64 } from "@better-update/encoding";
import { compact, toOptional } from "@better-update/type-guards";
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
import {
  buildTokenRequestContext,
  isCertificateLimitMessage,
  messageOf,
} from "./apple-asc-connect";
import { extractMetadataFromP12, normalizeAppleSerial } from "./apple-cert-to-p12";
import { fetchAscCredentials } from "./asc-credentials";
import { CertificateLimitError, computeDeviceRosterHashHex } from "./credentials-generator";

import type { ApiClient } from "../services/api-client";

// Re-exported so Apple-ID-session generators (asc-key, apns, merchant) keep a single
// import site for the shared error helpers.
export { messageOf };

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

export const wrap = <T>(step: string, run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new AppleIdGenerateFailedError({ step, message: messageOf(cause) }),
  });

/**
 * Build a headless ASC `RequestContext` by decrypting a stored ASC `.p8` key.
 * Used by the non-interactive (build/manager) callers that hold an `ascApiKeyId`
 * rather than an Apple ID cookie session.
 */
export const ascKeyRequestContext = (api: ApiClient, ascApiKeyId: string) =>
  fetchAscCredentials(api, ascApiKeyId).pipe(Effect.map(buildTokenRequestContext));

const wrapCertificateCreate = <T>(run: () => Promise<T>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => {
      const message = messageOf(cause);
      if (isCertificateLimitMessage(message)) {
        return new CertificateLimitError({ message });
      }
      return new AppleIdGenerateFailedError({ step: "apple-create-certificate", message });
    },
  });

const certificateTypeOf = (
  certificateType: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT" | undefined,
): AppleUtils.CertificateType =>
  certificateType === "IOS_DEVELOPMENT"
    ? AppleUtils.CertificateType.IOS_DEVELOPMENT
    : AppleUtils.CertificateType.IOS_DISTRIBUTION;

export interface GenerateCertificateInput {
  readonly context: AppleUtils.RequestContext;
  readonly certificateType?: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT";
}

export const generateAndUploadDistributionCertificate = (
  api: ApiClient,
  input: GenerateCertificateInput,
) =>
  Effect.gen(function* () {
    const ctx = input.context;
    const result = yield* wrapCertificateCreate(async () =>
      AppleUtils.createCertificateAndP12Async(ctx, {
        certificateType: certificateTypeOf(input.certificateType),
      }),
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

export interface DistributionCertificateSummary {
  readonly developerPortalIdentifier: string;
  readonly serialNumber: string;
  readonly displayName: string;
  readonly certificateType: string;
  readonly expirationDate: string;
}

export const listDistributionCerts = (
  ctx: AppleUtils.RequestContext,
  certificateType: "IOS_DISTRIBUTION" | "IOS_DEVELOPMENT" = "IOS_DISTRIBUTION",
) =>
  Effect.gen(function* () {
    const certs = yield* wrap("apple-list-certificates", async () =>
      AppleUtils.Certificate.getAsync(ctx, {
        query: { filter: { certificateType: certificateTypeOf(certificateType) } },
      }),
    );
    return certs.map(
      (entry) =>
        ({
          developerPortalIdentifier: entry.id,
          serialNumber: entry.attributes.serialNumber,
          displayName: entry.attributes.displayName,
          certificateType: entry.attributes.certificateType,
          expirationDate: entry.attributes.expirationDate,
        }) satisfies DistributionCertificateSummary,
    );
  });

export const revokeDistributionCert = (
  ctx: AppleUtils.RequestContext,
  developerPortalIdentifier: string,
) =>
  wrap("apple-revoke-certificate", async () =>
    AppleUtils.Certificate.deleteAsync(ctx, { id: developerPortalIdentifier }),
  );

export interface RevokeLocalDistributionCertificateInput {
  readonly ascApiKeyId: string;
  readonly distributionCertificateId: string;
  readonly keepLocal?: boolean;
}

export interface RevokeLocalDistributionCertificateResult {
  readonly localId: string;
  readonly serialNumber: string;
  readonly revokedOnApple: boolean;
  readonly deletedLocally: boolean;
}

/**
 * Revoke the distribution certificate behind a stored row: match it on Apple by
 * serial (across distribution + development), delete it there, and optionally
 * delete the local row. Builds a headless Token context from the ASC key.
 */
export const revokeLocalDistributionCertificate = (
  api: ApiClient,
  input: RevokeLocalDistributionCertificateInput,
) =>
  Effect.gen(function* () {
    const listing = yield* api.appleDistributionCertificates.list();
    const local = listing.items.find((entry) => entry.id === input.distributionCertificateId);
    if (local === undefined) {
      return yield* new AppleIdGenerateFailedError({
        step: "load-distribution-certificate",
        message: `Distribution certificate ${input.distributionCertificateId} not found on this account`,
      });
    }

    const creds = yield* fetchAscCredentials(api, input.ascApiKeyId);
    const ctx = buildTokenRequestContext(creds);
    const targetSerial = normalizeAppleSerial(local.serialNumber);

    const matching = yield* Effect.all(
      [
        wrap("apple-list-certificates", async () =>
          AppleUtils.Certificate.getAsync(ctx, {
            query: { filter: { certificateType: AppleUtils.CertificateType.IOS_DISTRIBUTION } },
          }),
        ),
        wrap("apple-list-certificates", async () =>
          AppleUtils.Certificate.getAsync(ctx, {
            query: { filter: { certificateType: AppleUtils.CertificateType.IOS_DEVELOPMENT } },
          }),
        ),
      ],
      { concurrency: 2 },
    );

    const ascMatch = [...matching[0], ...matching[1]].find(
      (entry) => normalizeAppleSerial(entry.attributes.serialNumber) === targetSerial,
    );

    let revokedOnApple = false;
    if (ascMatch !== undefined) {
      yield* wrap("apple-revoke-certificate", async () =>
        AppleUtils.Certificate.deleteAsync(ctx, { id: ascMatch.id }),
      );
      revokedOnApple = true;
    }

    let deletedLocally = false;
    if (input.keepLocal !== true) {
      yield* api.appleDistributionCertificates.delete({
        path: { id: input.distributionCertificateId },
      });
      deletedLocally = true;
    }

    return {
      localId: input.distributionCertificateId,
      serialNumber: local.serialNumber,
      revokedOnApple,
      deletedLocally,
    } satisfies RevokeLocalDistributionCertificateResult;
  });

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
    const target = normalizeAppleSerial(serialNumber);
    const match = certs.find(
      (entry) => normalizeAppleSerial(entry.attributes.serialNumber) === target,
    );
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

export interface GenerateProvisioningProfileInput {
  readonly context: AppleUtils.RequestContext;
  readonly distributionCertificateId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly deviceIds?: readonly string[];
}

export const generateAndUploadProvisioningProfile = (
  api: ApiClient,
  input: GenerateProvisioningProfileInput,
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
    const profileBase64 = toBase64(fromBase64(profileContent));
    const rosterHash = useDevices ? computeDeviceRosterHashHex(deviceIds) : undefined;

    const created = yield* api.appleProvisioningProfiles.upload({
      payload: {
        profileBase64,
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
      /** Raw .mobileprovision bytes (base64) — callers can install without re-downloading. */
      profileBase64,
    };
  });
