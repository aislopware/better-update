import { Effect, Ref } from "effect";

import type { IosBundleConfiguration } from "@better-update/api";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import {
  ascKeyRequestContext,
  generateAndUploadProvisioningProfile,
} from "../lib/credentials-generator-apple";
import { MissingCredentialsError } from "../lib/exit-codes";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman } from "../lib/output";
import { promptSelect } from "../lib/prompts";
import { regenerateProvisioningProfileViaAppleId } from "./credentials-interactive-apple-id";

import type { ApiClient } from "../services/api-client";
import type { IosSetupInput } from "./credentials-interactive-ios-asc";

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
 * Apple ID path (declined or no matching key). Interactive runs only — see
 * {@link teamAscKeyId} for the headless counterpart.
 */
const offerAscKeyBinding = (
  api: ApiClient,
  config: IosBundleConfiguration,
  memo?: AscBindingMemo,
) =>
  Effect.gen(function* () {
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
      yield* printHuman(
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
    yield* printHuman("ASC API key bound — this and future regenerations skip Apple ID login.");
    return chosen;
  });

/**
 * Mirrors the server's team-scoped fallback (`resolveAscApiKeyId` in
 * `resolve-build-credentials.ts`): one key per Apple team provisions every
 * bundle under it. Used where no prompt is possible — without it a headless run
 * dead-ends on an Apple ID login it can never complete, even though the org
 * holds a perfectly usable key. `ascApiKeys.list()` comes back newest-first, so
 * the first team match is the same key the server resolves.
 */
const teamAscKeyId = (api: ApiClient, config: IosBundleConfiguration) =>
  Effect.gen(function* () {
    const ascKeys = yield* api.ascApiKeys.list();
    const match = ascKeys.items.find((key) => key.appleTeamId === config.appleTeamId);
    return match === undefined ? null : match.id;
  });

export interface RegenerateProfileOptions {
  /** Share the per-team ASC-key answers across a multi-bundle loop. */
  readonly memo?: AscBindingMemo | undefined;
  /**
   * ASC key the caller already resolved — the build-credentials resolve response
   * carries one per bundle. Skips both the binding offer and the team lookup.
   */
  readonly ascApiKeyId?: string | undefined;
}

const regenerationAscKeyId = (
  api: ApiClient,
  config: IosBundleConfiguration,
  options: RegenerateProfileOptions | undefined,
) =>
  Effect.gen(function* () {
    const preresolved = options?.ascApiKeyId ?? config.ascApiKeyId;
    if (preresolved !== null) {
      return preresolved;
    }
    const mode = yield* InteractiveMode;
    return mode.allow
      ? yield* offerAscKeyBinding(api, config, options?.memo)
      : yield* teamAscKeyId(api, config);
  });

export const regenerateProvisioningProfile = (
  api: ApiClient,
  input: IosSetupInput,
  options?: RegenerateProfileOptions,
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
    const ascApiKeyId = yield* regenerationAscKeyId(api, config, options);
    if (ascApiKeyId === null) {
      const mode = yield* InteractiveMode;
      if (!mode.allow) {
        return yield* new MissingCredentialsError({
          message: `Cannot regenerate the provisioning profile for ${input.bundleIdentifier}: no App Store Connect API key is stored for its Apple team, and the Apple ID fallback needs an interactive session.`,
          hint: "Store one with `better-update credentials upload-asc-key` (or `credentials generate asc-key` from an interactive terminal) so headless runs regenerate over the ASC API.",
        });
      }
      return yield* regenerateProvisioningProfileViaAppleId(
        api,
        {
          bundleIdentifier: input.bundleIdentifier,
          distributionCertificateId: config.appleDistributionCertificateId,
          distributionType,
          bundleConfigurationId: config.id,
        },
        options?.memo === undefined
          ? undefined
          : { ascKeyOfferSettled: options.memo.ascKeyOfferSettled },
      );
    }
    yield* printHuman("Regenerating provisioning profile via App Store Connect API...");
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
