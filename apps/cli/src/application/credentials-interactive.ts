import { randomBytes } from "node:crypto";

import { Console, Effect, Ref } from "effect";

import type { IosBundleConfiguration } from "@better-update/api";

import { keystoreChoice } from "../lib/credential-choices";
import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import { generateAndUploadKeystore } from "../lib/credentials-generator";
import {
  ascKeyRequestContext,
  generateAndUploadProvisioningProfile,
} from "../lib/credentials-generator-apple";
import { MissingCredentialsError } from "../lib/exit-codes";
import { InteractiveMode } from "../lib/interactive-mode";
import { promptPassword, promptSelect, promptText } from "../lib/prompts";
import {
  chooseIosSetupPath,
  regenerateProvisioningProfileViaAppleId,
  setupIosViaAppleId,
} from "./credentials-interactive-apple-id";
import { setupIosViaAscKey } from "./credentials-interactive-ios-asc";

import type { ApiClient } from "../services/api-client";
import type { AppleIdSetupReuse, IosSetupPath } from "./credentials-interactive-apple-id";
import type { AscSetupReuse, IosSetupInput } from "./credentials-interactive-ios-asc";

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
    const created = yield* generateAndUploadKeystore(api, {
      keyAlias: "upload",
      storePassword: randomKeystoreSecret(),
      keyPassword: randomKeystoreSecret(),
      commonName: applicationIdentifier,
      organization: "better-update",
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
      return yield* new MissingCredentialsError({
        message: "No existing keystores in this organization.",
        hint: "Re-run and choose 'Generate new keystore'.",
      });
    }
    return yield* promptSelect<string>("Select a keystore", keystores.items.map(keystoreChoice));
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

// Creating an app identifier auto-seeds a "Default" credentials group with a
// null keystore, and (app identifier, name) is UNIQUE. So bind by UPDATEing the
// existing default group; only CREATE when none exists. A blind create here
// always collided with the seeded "Default" row → 500.
const bindAndroidKeystore = (api: ApiClient, appId: string, keystoreId: string) =>
  Effect.gen(function* () {
    const existing = yield* api.androidBuildCredentials.list({
      path: { applicationIdentifierId: appId },
    });
    const target = existing.items.find((group) => group.isDefault) ?? existing.items.at(0);
    if (target === undefined) {
      yield* api.androidBuildCredentials.create({
        path: { applicationIdentifierId: appId },
        payload: { name: "Default", isDefault: true, androidUploadKeystoreId: keystoreId },
      });
      return;
    }
    yield* api.androidBuildCredentials.update({
      path: { id: target.id },
      payload: { androidUploadKeystoreId: keystoreId },
    });
  });

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
      return yield* new MissingCredentialsError({
        message: `Build aborted — no keystore bound to ${input.applicationIdentifier}.`,
        hint: "Run `better-update credentials generate keystore` or upload via the dashboard.",
      });
    }

    const keystoreId = yield* choice === "generate"
      ? generateKeystoreAuto(api, input.applicationIdentifier)
      : pickExistingKeystore(api);

    yield* bindAndroidKeystore(api, appId, keystoreId);
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

/**
 * Per-run memory for the ASC-key questions asked while regenerating stale
 * profiles, so a loop over many bundle configurations asks each question once
 * instead of once per bundle. Only explicit user answers are remembered —
 * silent skips (no keys on the team yet) stay uncached so a key minted mid-run
 * still gets offered to later bundles.
 */
export interface AscBindingMemo {
  /** Internal Apple team id → chosen ASC key id, or null when the user declined. */
  readonly bindChoiceByTeam: Ref.Ref<ReadonlyMap<string, string | null>>;
  /** The mint-an-ASC-key-from-this-session offer was already answered this run. */
  readonly ascKeyOfferSettled: Ref.Ref<boolean>;
}

export const makeAscBindingMemo: Effect.Effect<AscBindingMemo> = Effect.all({
  bindChoiceByTeam: Ref.make<ReadonlyMap<string, string | null>>(new Map()),
  ascKeyOfferSettled: Ref.make(false),
});

/**
 * Interactive answers shared across a multi-target iOS setup loop (main app +
 * app extensions): the setup path, distribution certificate, and ASC key are
 * the same for every bundle, so ask once and reuse — only the per-bundle
 * provisioning-profile questions repeat.
 */
export interface IosSetupSession extends AscBindingMemo {
  readonly path: Ref.Ref<IosSetupPath | null>;
  readonly asc: Ref.Ref<AscSetupReuse | null>;
  readonly appleId: Ref.Ref<AppleIdSetupReuse | null>;
}

export const makeIosSetupSession: Effect.Effect<IosSetupSession> = Effect.all({
  path: Ref.make<IosSetupPath | null>(null),
  asc: Ref.make<AscSetupReuse | null>(null),
  appleId: Ref.make<AppleIdSetupReuse | null>(null),
  bindChoiceByTeam: Ref.make<ReadonlyMap<string, string | null>>(new Map()),
  ascKeyOfferSettled: Ref.make(false),
});

export interface EnsureCredentialsOptions {
  readonly freezeCredentials: boolean;
  /** Share interactive answers across a multi-target loop — see {@link IosSetupSession}. */
  readonly setupSession?: IosSetupSession;
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
          return yield* new MissingCredentialsError({
            message: `No Android build credentials for ${input.applicationIdentifier}.`,
            hint: options.freezeCredentials
              ? "Run `better-update credentials generate` first, or remove --freeze-credentials."
              : "Run `better-update credentials generate` first, or rerun with --interactive to configure now.",
          });
        }
        yield* setupAndroidInteractive(api, input);
        return yield* ensureAndroidCredentialsAvailable(api, input);
      }),
    ),
  );

// ── iOS ────────────────────────────────────────────────────────────

const setupIosInteractive = (api: ApiClient, input: IosSetupInput, session?: IosSetupSession) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(
      `No iOS bundle configuration for ${input.bundleIdentifier} (${input.distribution}).`,
    );
    const remembered = session === undefined ? null : yield* Ref.get(session.path);
    const path = remembered ?? (yield* chooseIosSetupPath(api));
    if (session !== undefined) {
      yield* Ref.set(session.path, path);
    }
    if (path === "apple-id") {
      return yield* setupIosViaAppleId(api, input, session?.appleId);
    }
    return yield* setupIosViaAscKey(api, input, session?.asc);
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
      return yield* new MissingCredentialsError({
        message: `iOS bundle configuration vanished while regenerating stale profile for ${input.bundleIdentifier}`,
        hint: "Retry; the configuration must exist before regeneration",
      });
    }
    return match;
  });

const APPLE_ID_FALLBACK = "__apple-id__";

/**
 * A bundle config without an ASC key regenerates via Apple ID login (2FA) on
 * EVERY stale profile — even when the org already holds an ASC key for the
 * config's team. Offer to bind one in place so future regenerations run
 * headless over the ASC API. Returns the bound key id, or null to keep the
 * Apple ID path (declined, no matching key, or non-interactive).
 */
const offerAscKeyBinding = (
  api: ApiClient,
  config: IosBundleConfiguration,
  memo?: AscBindingMemo,
) =>
  Effect.gen(function* () {
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      return null;
    }
    const remembered =
      memo === undefined
        ? undefined
        : (yield* Ref.get(memo.bindChoiceByTeam)).get(config.appleTeamId);
    if (remembered !== undefined) {
      if (remembered === null) {
        return null;
      }
      yield* api.iosBundleConfigurations.update({
        path: { id: config.id },
        payload: { ascApiKeyId: remembered },
      });
      yield* Console.log(
        `Bound the previously chosen ASC API key to ${config.bundleIdentifier} as well.`,
      );
      return remembered;
    }
    const ascKeys = yield* api.ascApiKeys.list();
    const teamKeys = ascKeys.items.filter((key) => key.appleTeamId === config.appleTeamId);
    if (teamKeys.length === 0) {
      return null;
    }
    const choice = yield* promptSelect<string>(
      `${config.bundleIdentifier} has no ASC API key bound, so regenerating asks for Apple ID + 2FA every time. Bind one now to regenerate headless?`,
      [
        ...teamKeys.map((key) => ({
          value: key.id,
          label: `Bind ${key.name} (${key.keyId})`,
        })),
        { value: APPLE_ID_FALLBACK, label: "No — continue with Apple ID login" },
      ],
    );
    const chosen = choice === APPLE_ID_FALLBACK ? null : choice;
    if (memo !== undefined) {
      yield* Ref.update(memo.bindChoiceByTeam, (entries) =>
        new Map(entries).set(config.appleTeamId, chosen),
      );
    }
    if (chosen === null) {
      return null;
    }
    yield* api.iosBundleConfigurations.update({
      path: { id: config.id },
      payload: { ascApiKeyId: chosen },
    });
    yield* Console.log("ASC API key bound — this and future regenerations skip Apple ID login.");
    return chosen;
  });

export const regenerateProvisioningProfile = (
  api: ApiClient,
  input: IosSetupInput,
  memo?: AscBindingMemo,
) =>
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
    const ascApiKeyId = config.ascApiKeyId ?? (yield* offerAscKeyBinding(api, config, memo));
    if (ascApiKeyId === null) {
      return yield* regenerateProvisioningProfileViaAppleId(
        api,
        {
          bundleIdentifier: input.bundleIdentifier,
          distributionCertificateId: config.appleDistributionCertificateId,
          distributionType,
          bundleConfigurationId: config.id,
        },
        memo === undefined ? undefined : { ascKeyOfferSettled: memo.ascKeyOfferSettled },
      );
    }
    yield* Console.log("Regenerating provisioning profile via App Store Connect API...");
    const context = yield* ascKeyRequestContext(api, ascApiKeyId);
    const created = yield* generateAndUploadProvisioningProfile(api, {
      context,
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
          return yield* new MissingCredentialsError({
            message: `No iOS build credentials for ${input.bundleIdentifier} (${input.distribution}).`,
            hint: options.freezeCredentials
              ? "Run `better-update credentials generate` first, or remove --freeze-credentials."
              : "Run `better-update credentials generate` first, or rerun with --interactive to configure now.",
          });
        }
        yield* setupIosInteractive(api, input, options.setupSession);
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
          return yield* new MissingCredentialsError({
            message: `Stale provisioning profile for ${input.bundleIdentifier}; cannot regenerate without an interactive session.`,
            hint: options.freezeCredentials
              ? "Run a build without --freeze-credentials once to refresh the profile, or run `better-update credentials regenerate-profile`."
              : "Run `better-update credentials regenerate-profile --bundle <id> --distribution <type>` from an interactive terminal.",
          });
        }
        yield* Console.log(
          `Stale provisioning profile for ${input.bundleIdentifier} (device roster changed). Regenerating...`,
        );
        yield* regenerateProvisioningProfile(api, input, options.setupSession);
        return undefined;
      }),
    ),
  );
