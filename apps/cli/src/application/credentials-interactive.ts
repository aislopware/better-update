import { randomBytes } from "node:crypto";

import { compact } from "@better-update/type-guards";
import { Console, Effect } from "effect";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import {
  generateAndUploadKeystore,
  generateAndUploadProvisioningProfile,
} from "../lib/credentials-generator";
import { MissingCredentialsError } from "../lib/exit-codes";
import { InteractiveMode } from "../lib/interactive-mode";
import { promptPassword, promptSelect, promptText } from "../lib/prompts";
import {
  chooseIosSetupPath,
  regenerateProvisioningProfileViaAppleId,
  setupIosViaAppleId,
} from "./credentials-interactive-apple-id";
import { setupIosViaAscKey } from "./credentials-interactive-ios-asc";
import { resolveVaultPassphrase } from "./vault-access";

import type { ApiClient } from "../services/api-client";
import type { IosSetupInput } from "./credentials-interactive-ios-asc";

export type {
  DistributionTypeValue,
  IosSetupContext,
  IosSetupInput,
} from "./credentials-interactive-ios-asc";
export {
  pickIosAscKey,
  pickIosCertificate,
  resolveIosProfileId,
} from "./credentials-interactive-ios-asc";

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

const randomKeystoreSecret = () => randomBytes(24).toString("base64url");

const generateKeystoreAuto = (api: ApiClient, applicationIdentifier: string) =>
  Effect.gen(function* () {
    yield* Console.log("Generating a new Android Keystore...");
    const passphrase = yield* resolveVaultPassphrase;
    const created = yield* generateAndUploadKeystore(api, {
      keyAlias: "upload",
      storePassword: randomKeystoreSecret(),
      keyPassword: randomKeystoreSecret(),
      commonName: applicationIdentifier,
      organization: "better-update",
      ...compact({ passphrase }),
    });
    return created.id;
  });

const generateKeystoreInteractive = (api: ApiClient) =>
  Effect.gen(function* () {
    const alias = yield* promptText("Key alias", { placeholder: "upload-key" });
    const storePassword = yield* promptPassword("Keystore password");
    const keyPassword = yield* promptPassword("Key password");
    const commonName = yield* promptText("Common name (CN)", { placeholder: "Your App" });
    const organization = yield* promptText("Organization (O)", { placeholder: "Your Company" });
    const passphrase = yield* resolveVaultPassphrase;
    yield* Console.log("Generating keystore with keytool...");
    const created = yield* generateAndUploadKeystore(api, {
      keyAlias: alias,
      storePassword,
      keyPassword,
      commonName,
      organization,
      ...compact({ passphrase }),
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

    const keystoreId = yield* choice === "generate"
      ? generateKeystoreAuto(api, input.applicationIdentifier)
      : pickExistingKeystore(api);

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
    Effect.catchIf(isMissingResolveError, () =>
      Effect.gen(function* () {
        const mode = yield* InteractiveMode;
        if (options.freezeCredentials || !mode.allow) {
          return yield* Effect.fail(
            new MissingCredentialsError({
              message: `No Android build credentials for ${input.applicationIdentifier}.`,
              hint: options.freezeCredentials
                ? "Run `better-update credentials generate` first, or remove --freeze-credentials."
                : "Run `better-update credentials generate` first, or rerun with --interactive to configure now.",
            }),
          );
        }
        yield* setupAndroidInteractive(api, input);
        return yield* ensureAndroidCredentialsAvailable(api, input);
      }),
    ),
  );

// ── iOS ────────────────────────────────────────────────────────────

const setupIosInteractive = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      `No iOS bundle configuration for ${input.bundleIdentifier} (${input.distribution}).`,
    );
    const path = yield* chooseIosSetupPath(api);
    if (path === "apple-id") {
      return yield* setupIosViaAppleId(api, input);
    }
    return yield* setupIosViaAscKey(api, input);
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

export const regenerateProvisioningProfile = (api: ApiClient, input: IosSetupInput) =>
  Effect.gen(function* () {
    const config = yield* findBoundIosConfig(api, input);
    if (config.appleDistributionCertificateId === null) {
      return yield* new MissingCredentialsError({
        message:
          "Profile cannot be regenerated: bundle configuration is missing the distribution certificate",
        hint: "Re-bind credentials via `better-update credentials generate` or the dashboard",
      });
    }
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    if (config.ascApiKeyId === null) {
      return yield* regenerateProvisioningProfileViaAppleId(api, {
        bundleIdentifier: input.bundleIdentifier,
        distributionCertificateId: config.appleDistributionCertificateId,
        distributionType,
        bundleConfigurationId: config.id,
      });
    }
    yield* Console.log("Regenerating provisioning profile via App Store Connect API...");
    const created = yield* generateAndUploadProvisioningProfile(api, {
      ascApiKeyId: config.ascApiKeyId,
      distributionCertificateId: config.appleDistributionCertificateId,
      bundleIdentifier: input.bundleIdentifier,
      distributionType,
    });
    yield* api.iosBundleConfigurations.update({
      path: { id: config.id },
      payload: { appleProvisioningProfileId: created.id },
    });
    return created;
  });

export const ensureIosCredentials = (
  api: ApiClient,
  input: IosSetupInput,
  options: EnsureCredentialsOptions,
) =>
  resolveIosBuildCredentials(api, input).pipe(
    Effect.catchIf(isMissingResolveError, () =>
      Effect.gen(function* () {
        const mode = yield* InteractiveMode;
        if (options.freezeCredentials || !mode.allow) {
          return yield* Effect.fail(
            new MissingCredentialsError({
              message: `No iOS build credentials for ${input.bundleIdentifier} (${input.distribution}).`,
              hint: options.freezeCredentials
                ? "Run `better-update credentials generate` first, or remove --freeze-credentials."
                : "Run `better-update credentials generate` first, or rerun with --interactive to configure now.",
            }),
          );
        }
        yield* setupIosInteractive(api, input);
        return yield* resolveIosBuildCredentials(api, input);
      }),
    ),
    Effect.flatMap((resolved) =>
      Effect.gen(function* () {
        if (resolved.platform !== "ios" || !resolved.profileStale) {
          return undefined;
        }
        const mode = yield* InteractiveMode;
        if (options.freezeCredentials || !mode.allow) {
          return yield* Effect.fail(
            new MissingCredentialsError({
              message: `Stale provisioning profile for ${input.bundleIdentifier}; cannot regenerate without an interactive session.`,
              hint: options.freezeCredentials
                ? "Run a build without --freeze-credentials once to refresh the profile, or run `better-update credentials regenerate-profile`."
                : "Run `better-update credentials regenerate-profile --bundle <id> --distribution <type>` from an interactive terminal.",
            }),
          );
        }
        yield* Console.log(
          `Stale provisioning profile for ${input.bundleIdentifier} (device roster changed). Regenerating...`,
        );
        yield* regenerateProvisioningProfile(api, input);
        return undefined;
      }),
    ),
  );
