import { fromBase64, toBase64 } from "@better-update/encoding";
// @expo/apple-utils is ncc-bundled CJS; `import * as` only surfaces `default`/`module.exports`
// via Node ESM's cjs-module-lexer, so the entity managers + enums (Certificate, BundleId,
// Profile, Device, ProfileType, CertificateType, ...) are read off the default import.
import AppleUtils from "@expo/apple-utils";
import { Data, Effect } from "effect";

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

    const created = yield* api.appleDistributionCertificates.upload({
      payload: {
        p12Base64: result.certificateP12,
        p12Password: result.password,
        serialNumber: metadata.serialNumber,
        appleTeamIdentifier: metadata.appleTeamId,
        ...(metadata.appleTeamName === null ? {} : { appleTeamName: metadata.appleTeamName }),
        ...(metadata.developerIdIdentifier === null
          ? {}
          : { developerIdIdentifier: metadata.developerIdIdentifier }),
        validFrom: metadata.validFrom,
        validUntil: metadata.validUntil,
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
      return yield* Effect.fail(
        new AppleIdGenerateFailedError({
          step: "match-apple-certificate",
          message: `Distribution certificate ${serialNumber} not present on Apple Developer Portal; upload or re-generate it`,
        }),
      );
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
      return yield* Effect.fail(
        new AppleIdGenerateFailedError({
          step: "collect-devices",
          message: "No registered devices to attach to the provisioning profile",
        }),
      );
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
      return yield* Effect.fail(
        new AppleIdGenerateFailedError({
          step: "extract-profile-content",
          message: "Apple returned a profile with no content (likely expired/invalid)",
        }),
      );
    }
    const profileBytes = fromBase64(profileContent);
    const rosterHash = useDevices ? computeDeviceRosterHashHex(deviceIds) : undefined;

    const created = yield* api.appleProvisioningProfiles.upload({
      payload: {
        profileBase64: toBase64(profileBytes),
        appleDistributionCertificateId: input.distributionCertificateId,
        isManaged: true,
        ...(rosterHash === undefined ? {} : { deviceRosterHash: rosterHash }),
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
