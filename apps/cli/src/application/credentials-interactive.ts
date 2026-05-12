import { Console, Effect } from "effect";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import {
  generateAndUploadDistributionCertificate,
  generateAndUploadKeystore,
  generateAndUploadProvisioningProfile,
  listAppleCertificates,
  revokeAppleCertificate,
} from "../lib/credentials-generator";
import { MissingCredentialsError } from "../lib/exit-codes";
import {
  promptConfirm,
  promptMultiSelect,
  promptPassword,
  promptSelect,
  promptText,
} from "../lib/prompts";

import type { IosDistribution } from "../lib/build-profile";
import type { ApiClient } from "../services/api-client";

interface TaggedCause {
  readonly _tag: string;
  readonly message?: string;
}

const hasTag = (cause: unknown): cause is TaggedCause =>
  typeof cause === "object" && cause !== null && "_tag" in cause;

const isMissingResolveError = (cause: unknown) =>
  hasTag(cause) && (cause._tag === "NotFound" || cause._tag === "BadRequest");

// ── Android ────────────────────────────────────────────────────────

export interface AndroidSetupInput {
  readonly projectId: string;
  readonly applicationIdentifier: string;
}

const generateKeystoreInteractive = (api: ApiClient) =>
  Effect.gen(function* () {
    const alias = yield* promptText("Key alias", { placeholder: "upload-key" });
    const storePassword = yield* promptPassword("Keystore password");
    const keyPassword = yield* promptPassword("Key password");
    const commonName = yield* promptText("Common name (CN)", { placeholder: "Your App" });
    const organization = yield* promptText("Organization (O)", { placeholder: "Your Company" });
    yield* Console.log("Generating keystore with keytool...");
    const created = yield* generateAndUploadKeystore(api, {
      keyAlias: alias,
      storePassword,
      keyPassword,
      commonName,
      organization,
    });
    return created.id;
  });

const pickExistingKeystore = (api: ApiClient) =>
  Effect.gen(function* () {
    const keystores = yield* api.androidUploadKeystores.list();
    if (keystores.items.length === 0) {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: "No existing keystores in this organization.",
          hint: "Re-run and choose 'Generate new keystore'.",
        }),
      );
    }
    return yield* promptSelect<string>(
      "Select a keystore",
      keystores.items.map((item) => ({ value: item.id, label: item.keyAlias })),
    );
  });

const resolveAndroidAppId = (api: ApiClient, input: AndroidSetupInput) =>
  Effect.gen(function* () {
    const apps = yield* api.androidApplicationIdentifiers.list({
      path: { projectId: input.projectId },
    });
    const existing = apps.items.find((item) => item.packageName === input.applicationIdentifier);
    if (existing !== undefined) {
      return existing.id;
    }
    const created = yield* api.androidApplicationIdentifiers.create({
      path: { projectId: input.projectId },
      payload: { packageName: input.applicationIdentifier },
    });
    return created.id;
  });

export const resolveAndroidKeystoreId = (api: ApiClient, choice: "generate" | "existing") =>
  choice === "generate" ? generateKeystoreInteractive(api) : pickExistingKeystore(api);

const setupAndroidInteractive = (api: ApiClient, input: AndroidSetupInput) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      `No Android build credentials configured for ${input.applicationIdentifier}.`,
    );

    const appId = yield* resolveAndroidAppId(api, input);

    const choice = yield* promptSelect<"generate" | "existing" | "abort">(
      "How would you like to provide a keystore?",
      [
        { value: "generate", label: "Generate new keystore" },
        { value: "existing", label: "Pick an existing keystore" },
        { value: "abort", label: "Abort — I'll configure it in the dashboard" },
      ],
    );

    if (choice === "abort") {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: `Build aborted — no keystore bound to ${input.applicationIdentifier}.`,
          hint: "Run `better-update credentials generate keystore` or upload via the dashboard.",
        }),
      );
    }

    const keystoreId = yield* resolveAndroidKeystoreId(api, choice);

    yield* api.androidBuildCredentials.create({
      path: { applicationIdentifierId: appId },
      payload: { name: "Default", isDefault: true, androidUploadKeystoreId: keystoreId },
    });
    yield* Console.log("Android build credentials configured.");
    return undefined;
  });

const ensureAndroidCredentialsAvailable = (api: ApiClient, input: AndroidSetupInput) =>
  api.buildCredentials
    .resolve({
      path: { projectId: input.projectId },
      payload: {
        platform: "android",
        applicationIdentifier: input.applicationIdentifier,
      },
    })
    .pipe(Effect.asVoid);

export interface EnsureCredentialsOptions {
  readonly freezeCredentials: boolean;
}

export const ensureAndroidCredentials = (
  api: ApiClient,
  input: AndroidSetupInput,
  options: EnsureCredentialsOptions,
) =>
  ensureAndroidCredentialsAvailable(api, input).pipe(
    Effect.catchIf(isMissingResolveError, () => {
      if (options.freezeCredentials) {
        return Effect.fail(
          new MissingCredentialsError({
            message: `No Android build credentials for ${input.applicationIdentifier}.`,
            hint: "Run `better-update credentials generate` first, or remove --freeze-credentials.",
          }),
        );
      }
      return setupAndroidInteractive(api, input).pipe(
        Effect.flatMap(() => ensureAndroidCredentialsAvailable(api, input)),
      );
    }),
  );

// ── iOS ────────────────────────────────────────────────────────────

export interface IosSetupInput {
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distribution: IosDistribution;
}

type DistributionTypeValue =
  (typeof IOS_DISTRIBUTION_TO_TYPE)[keyof typeof IOS_DISTRIBUTION_TO_TYPE];

export interface IosSetupContext {
  readonly certId: string;
  readonly cert: { readonly appleTeamId: string };
  readonly ascKeyId: string;
  readonly distributionType: DistributionTypeValue;
}

const interactiveCertLimitRecover = (api: ApiClient, ascApiKeyId: string) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      "Apple reports the certificate limit was hit (max 3 distribution certs per team).",
    );
    const certs = yield* listAppleCertificates(api, {
      ascApiKeyId,
      certificateType: "IOS_DISTRIBUTION",
    });
    if (certs.length === 0) {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message:
            "Apple says the certificate limit is hit but no existing certificates were returned.",
          hint: "Try again later or check the Apple Developer portal.",
        }),
      );
    }
    const toRevoke = yield* promptMultiSelect<string>(
      "Select one or more certificates to revoke before retrying",
      certs.map((entry) => ({
        value: entry.id,
        label: `${entry.serialNumber.slice(0, 12)}… (${entry.displayName ?? entry.certificateType}, exp ${entry.expirationDate.slice(0, 10)})`,
      })),
      { required: true },
    );
    yield* Effect.forEach(
      toRevoke,
      (id) => revokeAppleCertificate(api, { ascApiKeyId, developerPortalIdentifier: id }),
      { concurrency: "inherit" },
    );
    yield* Console.log(`Revoked ${toRevoke.length} certificate(s); retrying generation...`);
    return undefined;
  });

const generateDistributionCertInteractive = (api: ApiClient) =>
  Effect.gen(function* () {
    const ascKeys = yield* api.ascApiKeys.list();
    const teamAscKeys = ascKeys.items.filter((key) => key.appleTeamId !== null);
    if (teamAscKeys.length === 0) {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: "No ASC API key linked to an Apple team in this organization.",
          hint: "Upload an ASC API key with a team assignment via the dashboard, then retry.",
        }),
      );
    }
    const ascKeyId = yield* promptSelect<string>(
      "Select an ASC API key to issue the certificate against",
      teamAscKeys.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
    yield* Console.log("Generating CSR and requesting certificate from Apple...");
    const generate = generateAndUploadDistributionCertificate(api, { ascApiKeyId: ascKeyId });
    return yield* generate.pipe(
      Effect.catchTag("CertificateLimitError", () =>
        interactiveCertLimitRecover(api, ascKeyId).pipe(Effect.flatMap(() => generate)),
      ),
    );
  });

const chooseIosCertificateId = (api: ApiClient) =>
  Effect.gen(function* () {
    const certs = yield* api.appleDistributionCertificates.list();
    if (certs.items.length === 0) {
      yield* Console.log("No distribution certificate found in this organization.");
      const choice = yield* promptSelect<"generate" | "abort">("How would you like to proceed?", [
        { value: "generate", label: "Generate a new distribution certificate" },
        { value: "abort", label: "Abort — I'll upload one manually" },
      ]);
      if (choice === "abort") {
        return yield* Effect.fail(
          new MissingCredentialsError({
            message: "Build aborted — no distribution certificate available.",
            hint: "Run `better-update credentials generate distribution-certificate --asc-key-id <id>` or upload via the dashboard.",
          }),
        );
      }
      const created = yield* generateDistributionCertInteractive(api);
      return created.id;
    }
    const choice = yield* promptSelect<string>(
      "Select a distribution certificate (or 'generate' for a fresh one)",
      [
        { value: "__generate__", label: "Generate a new distribution certificate" },
        ...certs.items.map((cert) => ({
          value: cert.id,
          label: `${cert.serialNumber.slice(0, 12)}… (team ${cert.appleTeamId})`,
        })),
      ],
    );
    if (choice === "__generate__") {
      const created = yield* generateDistributionCertInteractive(api);
      return created.id;
    }
    return choice;
  });

export const pickIosCertificate = (api: ApiClient) =>
  Effect.gen(function* () {
    const chosenId = yield* chooseIosCertificateId(api);
    const refreshed = yield* api.appleDistributionCertificates.list();
    const cert = refreshed.items.find((entry) => entry.id === chosenId);
    if (cert === undefined) {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: "Selected certificate not found after generation.",
          hint: "Retry.",
        }),
      );
    }
    return { certId: chosenId, cert };
  });

export const pickIosAscKey = (api: ApiClient, appleTeamId: string) =>
  Effect.gen(function* () {
    const ascKeys = yield* api.ascApiKeys.list();
    const teamAscKeys = ascKeys.items.filter(
      (key) => key.appleTeamId !== null && key.appleTeamId === appleTeamId,
    );
    if (teamAscKeys.length === 0) {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: `No ASC API key linked to Apple team ${appleTeamId}.`,
          hint: "Upload an ASC API key for that team via the dashboard, then retry.",
        }),
      );
    }
    return yield* promptSelect<string>(
      "Select an ASC API key",
      teamAscKeys.map((key) => ({ value: key.id, label: `${key.name} (${key.keyId})` })),
    );
  });

const generateProvisioningProfileForBundle = (
  api: ApiClient,
  input: IosSetupInput,
  ctx: IosSetupContext,
) =>
  Effect.gen(function* () {
    yield* Console.log("Generating provisioning profile via App Store Connect API...");
    const generated = yield* generateAndUploadProvisioningProfile(api, {
      ascApiKeyId: ctx.ascKeyId,
      distributionCertificateId: ctx.certId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType: ctx.distributionType,
    });
    return generated.id;
  });

export const resolveIosProfileId = (api: ApiClient, input: IosSetupInput, ctx: IosSetupContext) =>
  Effect.gen(function* () {
    const profiles = yield* api.appleProvisioningProfiles.list({ urlParams: {} });
    const matching = profiles.items.filter(
      (profile) =>
        profile.bundleIdentifier === input.bundleIdentifier &&
        profile.distributionType === ctx.distributionType &&
        profile.appleTeamId === ctx.cert.appleTeamId,
    );
    if (matching.length === 0) {
      return yield* generateProvisioningProfileForBundle(api, input, ctx);
    }
    const useExisting = yield* promptConfirm(
      `Reuse an existing ${input.distribution} profile for ${input.bundleIdentifier}?`,
      { initialValue: true },
    );
    if (!useExisting) {
      return yield* generateProvisioningProfileForBundle(api, input, ctx);
    }
    return yield* promptSelect<string>(
      "Select a provisioning profile",
      matching.map((profile) => ({
        value: profile.id,
        label: profile.profileName ?? profile.developerPortalIdentifier ?? profile.id,
      })),
    );
  });

const setupIosInteractive = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      `No iOS bundle configuration for ${input.bundleIdentifier} (${input.distribution}).`,
    );

    const { certId, cert } = yield* pickIosCertificate(api);
    const ascKeyId = yield* pickIosAscKey(api, cert.appleTeamId);
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    const ctx: IosSetupContext = { certId, cert, ascKeyId, distributionType };
    const profileId = yield* resolveIosProfileId(api, input, ctx);

    yield* api.iosBundleConfigurations.create({
      path: { projectId: input.projectId },
      payload: {
        bundleIdentifier: input.bundleIdentifier,
        distributionType,
        appleTeamId: cert.appleTeamId,
        appleDistributionCertificateId: certId,
        appleProvisioningProfileId: profileId,
        ascApiKeyId: ascKeyId,
      },
    });
    yield* Console.log("iOS bundle configuration saved.");
    return undefined;
  });

const resolveIosBuildCredentials = (api: ApiClient, input: IosSetupInput) =>
  api.buildCredentials.resolve({
    path: { projectId: input.projectId },
    payload: {
      platform: "ios",
      bundleIdentifier: input.bundleIdentifier,
      distributionType: IOS_DISTRIBUTION_TO_TYPE[input.distribution],
    },
  });

const findBoundIosConfig = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    const configs = yield* api.iosBundleConfigurations.list({
      path: { projectId: input.projectId },
    });
    const match = configs.items.find(
      (config) =>
        config.bundleIdentifier === input.bundleIdentifier &&
        config.distributionType === distributionType,
    );
    if (match === undefined) {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message: `iOS bundle configuration vanished while regenerating stale profile for ${input.bundleIdentifier}`,
          hint: "Retry; the configuration must exist before regeneration",
        }),
      );
    }
    return match;
  });

const regenerateStaleProfile = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      `Provisioning profile for ${input.bundleIdentifier} (${input.distribution}) is stale (device roster changed). Regenerating via App Store Connect API...`,
    );
    const config = yield* findBoundIosConfig(api, input);
    if (config.ascApiKeyId === null || config.appleDistributionCertificateId === null) {
      return yield* Effect.fail(
        new MissingCredentialsError({
          message:
            "Stale profile cannot be regenerated: bundle configuration is missing ASC key or distribution certificate",
          hint: "Re-bind credentials via `better-update credentials generate` or the dashboard",
        }),
      );
    }
    yield* generateAndUploadProvisioningProfile(api, {
      ascApiKeyId: config.ascApiKeyId,
      distributionCertificateId: config.appleDistributionCertificateId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType: IOS_DISTRIBUTION_TO_TYPE[input.distribution],
    });
    yield* Console.log("Stale profile regenerated.");
    return undefined;
  });

export const ensureIosCredentials = (
  api: ApiClient,
  input: IosSetupInput,
  options: EnsureCredentialsOptions,
) =>
  resolveIosBuildCredentials(api, input).pipe(
    Effect.catchIf(isMissingResolveError, () => {
      if (options.freezeCredentials) {
        return Effect.fail(
          new MissingCredentialsError({
            message: `No iOS build credentials for ${input.bundleIdentifier} (${input.distribution}).`,
            hint: "Run `better-update credentials generate` first, or remove --freeze-credentials.",
          }),
        );
      }
      return setupIosInteractive(api, input).pipe(
        Effect.flatMap(() => resolveIosBuildCredentials(api, input)),
      );
    }),
    Effect.flatMap((resolved) => {
      if (resolved.platform !== "ios" || !resolved.profileStale) {
        return Effect.succeed(undefined);
      }
      if (options.freezeCredentials) {
        return Effect.fail(
          new MissingCredentialsError({
            message: `Stale provisioning profile for ${input.bundleIdentifier}; cannot regenerate with --freeze-credentials.`,
            hint: "Run a build without --freeze-credentials once to refresh the profile.",
          }),
        );
      }
      return regenerateStaleProfile(api, input);
    }),
  );
