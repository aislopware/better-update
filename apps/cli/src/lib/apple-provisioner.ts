import { Console, Effect } from "effect";

import { importAppleUtils } from "./apple-utils-import";
import { AppleProvisioningError } from "./exit-codes";

import type { AppleAuthContext } from "./apple-auth";
import type { IosDistribution } from "./build-profile";

// ── result types ─────────────────────────────────────────────────

export interface AppleProvisioningResult {
  readonly certificate: {
    readonly p12Base64: string;
    readonly p12Password: string;
    readonly serialNumber: string;
  };
  readonly profile: {
    readonly contentBase64: string;
    readonly name: string;
    readonly uuid: string;
  };
}

// ── internal helpers ─────────────────────────────────────────────

const loadAppleUtils = () =>
  importAppleUtils((message) => new AppleProvisioningError({ message, step: "import" }));

// ── bundle ID ────────────────────────────────────────────────────

const ensureBundleId = (params: {
  readonly ctx: AppleAuthContext["requestContext"];
  readonly identifier: string;
  readonly name: string;
}) =>
  Effect.gen(function* () {
    const { BundleId } = yield* loadAppleUtils();
    const { ctx, identifier, name } = params;

    yield* Console.log(`Checking bundle ID: ${identifier}...`);

    const existing = yield* Effect.tryPromise({
      try: () => BundleId.findAsync(ctx, { identifier }),
      catch: (error) =>
        new AppleProvisioningError({
          message: `Failed to search for bundle ID "${identifier}": ${String(error)}`,
          step: "bundle-id",
        }),
    });

    if (existing) {
      yield* Console.log(`Bundle ID "${identifier}" already registered.`);
      return existing;
    }

    yield* Console.log(`Registering bundle ID "${identifier}"...`);

    const created = yield* Effect.tryPromise({
      try: () => BundleId.createAsync(ctx, { name, identifier }),
      catch: (error) =>
        new AppleProvisioningError({
          message: `Failed to register bundle ID "${identifier}": ${String(error)}`,
          step: "bundle-id",
        }),
    });

    yield* Console.log(`Bundle ID "${identifier}" registered.`);
    return created;
  });

// ── distribution certificate ─────────────────────────────────────

const createSigningCertificate = (
  ctx: AppleAuthContext["requestContext"],
  distribution: IosDistribution,
) =>
  Effect.gen(function* () {
    const { CertificateType, createCertificateAndP12Async } = yield* loadAppleUtils();

    const certType =
      distribution === "development"
        ? CertificateType.IOS_DEVELOPMENT
        : CertificateType.IOS_DISTRIBUTION;
    const label = distribution === "development" ? "development" : "distribution";

    yield* Console.log(`Creating iOS ${label} certificate...`);

    const result = yield* Effect.tryPromise({
      try: () =>
        createCertificateAndP12Async(ctx, {
          certificateType: certType,
        }),
      catch: (error) =>
        new AppleProvisioningError({
          message: `Failed to create ${label} certificate: ${String(error)}`,
          step: "certificate",
        }),
    });

    yield* Console.log(
      `${label[0]!.toUpperCase()}${label.slice(1)} certificate created (serial: ${result.certificate.attributes.serialNumber}).`,
    );

    return {
      certificateId: result.certificate.id,
      p12Base64: result.certificateP12,
      p12Password: result.password,
      serialNumber: result.certificate.attributes.serialNumber,
    };
  });

// ── provisioning profile ─────────────────────────────────────────

type AppleUtilsModule = typeof import("@expo/apple-utils");

const distributionToProfileType = (appleUtils: AppleUtilsModule, distribution: IosDistribution) => {
  switch (distribution) {
    case "app-store":
      return appleUtils.ProfileType.IOS_APP_STORE;
    case "ad-hoc":
      return appleUtils.ProfileType.IOS_APP_ADHOC;
    case "development":
      return appleUtils.ProfileType.IOS_APP_DEVELOPMENT;
    case "enterprise":
      return appleUtils.ProfileType.IOS_APP_INHOUSE;
  }
};

const needsDevices = (distribution: IosDistribution): boolean =>
  distribution === "ad-hoc" || distribution === "development";

const createProvisioningProfile = (params: {
  readonly ctx: AppleAuthContext["requestContext"];
  readonly bundleIdOpaqueId: string;
  readonly certificateId: string;
  readonly distribution: IosDistribution;
  readonly bundleIdentifier: string;
}) =>
  Effect.gen(function* () {
    const appleUtils = yield* loadAppleUtils();
    const { ctx, bundleIdOpaqueId, certificateId, distribution, bundleIdentifier } = params;

    const profileType = distributionToProfileType(appleUtils, distribution);
    const profileName = `*[better-update] ${bundleIdentifier} ${distribution} ${new Date().toISOString()}`;

    // Fetch device IDs for ad-hoc / development profiles.
    let deviceIds: string[] = [];

    if (needsDevices(distribution)) {
      yield* Console.log("Fetching registered devices...");

      const devices = yield* Effect.tryPromise({
        try: () => appleUtils.Device.getAllIOSProfileDevicesAsync(ctx),
        catch: (error) =>
          new AppleProvisioningError({
            message: `Failed to fetch registered devices: ${String(error)}`,
            step: "devices",
          }),
      });

      if (devices.length === 0) {
        return yield* new AppleProvisioningError({
          message:
            `No registered iOS devices found. ${distribution} profiles require at least one device. ` +
            "Register a device in Apple Developer Portal or via `better-update credentials` first.",
          step: "devices",
        });
      }

      deviceIds = devices.map((d) => d.id);
      yield* Console.log(`Including ${devices.length} device(s) in profile.`);
    }

    yield* Console.log(`Creating ${distribution} provisioning profile...`);

    const profile = yield* Effect.tryPromise({
      try: () =>
        appleUtils.Profile.createAsync(ctx, {
          bundleId: bundleIdOpaqueId,
          certificates: [certificateId],
          devices: deviceIds,
          name: profileName,
          profileType,
        }),
      catch: (error) =>
        new AppleProvisioningError({
          message: `Failed to create provisioning profile: ${String(error)}`,
          step: "profile",
        }),
    });

    if (!profile.attributes.profileContent) {
      return yield* new AppleProvisioningError({
        message: "Created profile has no content (may be expired or invalid).",
        step: "profile",
      });
    }

    yield* Console.log(`Provisioning profile created: ${profileName}`);

    return {
      contentBase64: profile.attributes.profileContent,
      name: profile.attributes.name,
      uuid: profile.attributes.uuid,
    };
  });

// ── public API ───────────────────────────────────────────────────

/**
 * Auto-provision iOS credentials via Apple Developer Portal:
 * 1. Ensure bundle ID is registered
 * 2. Create distribution certificate (CSR → Apple → p12)
 * 3. Create provisioning profile (with devices for ad-hoc/development)
 */
export const autoProvisionIosCredentials = (params: {
  readonly authContext: AppleAuthContext;
  readonly bundleIdentifier: string;
  readonly distribution: IosDistribution;
  readonly appName: string;
}): Effect.Effect<AppleProvisioningResult, AppleProvisioningError> =>
  Effect.gen(function* () {
    const { authContext, bundleIdentifier, distribution, appName } = params;
    const ctx = authContext.requestContext;

    // 1. Ensure bundle ID exists in Apple Developer Portal.
    const bundleId = yield* ensureBundleId({
      ctx,
      identifier: bundleIdentifier,
      name: appName,
    });

    // 2. Create signing certificate (development or distribution).
    const cert = yield* createSigningCertificate(ctx, distribution);

    // 3. Create provisioning profile.
    const profile = yield* createProvisioningProfile({
      ctx,
      bundleIdOpaqueId: bundleId.id,
      certificateId: cert.certificateId,
      distribution,
      bundleIdentifier,
    });

    yield* Console.log("");
    yield* Console.log("iOS credentials auto-provisioned successfully:");
    yield* Console.log(`  Certificate: ${cert.serialNumber}`);
    yield* Console.log(`  Profile: ${profile.name}`);

    return {
      certificate: {
        p12Base64: cert.p12Base64,
        p12Password: cert.p12Password,
        serialNumber: cert.serialNumber,
      },
      profile: {
        contentBase64: profile.contentBase64,
        name: profile.name,
        uuid: profile.uuid,
      },
    } satisfies AppleProvisioningResult;
  });
