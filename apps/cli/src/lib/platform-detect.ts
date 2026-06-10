import { Effect } from "effect";

import { BuildProfileError } from "./exit-codes";
import { InteractiveMode } from "./interactive-mode";
import { promptSelect } from "./prompts";

import type { BuildProfile, Platform } from "./build-profile";
import type { InteractiveProhibitedError } from "./exit-codes";
import type { ExpoConfig } from "./expo-config";

const PLATFORMS = ["ios", "android"] as const;

const inferPlatforms = (config: ExpoConfig): readonly Platform[] => {
  const fromConfig: unknown = config["platforms"];
  if (Array.isArray(fromConfig)) {
    return fromConfig.filter((entry): entry is Platform => entry === "ios" || entry === "android");
  }
  const present: Platform[] = [];
  if (config.ios !== undefined) {
    present.push("ios");
  }
  if (config.android !== undefined) {
    present.push("android");
  }
  return present;
};

/**
 * Resolve a build platform from an explicit flag, or fall back to the Expo
 * config (`expo.platforms` or the presence of `ios`/`android` sections). The
 * config is loaded lazily so an explicit `--platform` skips evaluating
 * `app.config.js`/`.ts` entirely. Prompts when the config declares both
 * platforms; fails when ambiguous and prompts are disallowed.
 */
export const detectPlatform = <Err, Req>(
  explicit: Platform | undefined,
  loadConfig: Effect.Effect<ExpoConfig, Err, Req>,
): Effect.Effect<
  Platform,
  BuildProfileError | InteractiveProhibitedError | Err,
  InteractiveMode | Req
> =>
  Effect.gen(function* () {
    if (explicit !== undefined) {
      return explicit;
    }
    const candidates = inferPlatforms(yield* loadConfig);
    if (candidates.length === 0) {
      return yield* new BuildProfileError({
        message:
          "Cannot infer build platform. Add an `ios` or `android` section to your Expo config, or pass --platform.",
      });
    }
    if (candidates.length === 1) {
      const [only] = candidates;
      if (only === undefined) {
        return yield* new BuildProfileError({
          message: "Internal: empty platform candidate list.",
        });
      }
      return only;
    }
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      return yield* new BuildProfileError({
        message: `Multiple platforms detected (${candidates.join(", ")}). Pass --platform explicitly when running non-interactively.`,
      });
    }
    return yield* promptSelect<Platform>(
      "Which platform to build?",
      PLATFORMS.filter((entry) => candidates.includes(entry)).map((entry) => ({
        value: entry,
        label: entry,
      })),
    );
  });

/**
 * Resolve a build platform for non-Expo projects from an explicit flag, or by
 * intersecting the profile's declared platform sections with the native dirs
 * present on disk. Prompts when both remain; fails when ambiguous and prompts
 * are disallowed.
 */
export const detectPlatformGeneric = (
  explicit: Platform | undefined,
  context: {
    readonly profile: BuildProfile;
    readonly hasAndroidDir: boolean;
    readonly hasIosDir: boolean;
  },
): Effect.Effect<Platform, BuildProfileError | InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    if (explicit !== undefined) {
      return explicit;
    }
    const candidates: Platform[] = [];
    // A profile section is the strongest signal; otherwise fall back to dir
    // presence so a single-platform native repo "just builds".
    const wantsIos =
      context.profile.ios !== undefined || context.profile.customCommand?.ios !== undefined;
    const wantsAndroid =
      context.profile.android !== undefined || context.profile.customCommand?.android !== undefined;
    if (wantsIos && (context.hasIosDir || context.profile.customCommand?.ios !== undefined)) {
      candidates.push("ios");
    }
    if (
      wantsAndroid &&
      (context.hasAndroidDir || context.profile.customCommand?.android !== undefined)
    ) {
      candidates.push("android");
    }
    if (candidates.length === 0) {
      return yield* new BuildProfileError({
        message:
          "Cannot infer build platform. Add an `ios` or `android` section to the build profile " +
          "in eas.json, or pass --platform.",
      });
    }
    const [only] = candidates;
    if (candidates.length === 1 && only !== undefined) {
      return only;
    }
    const mode = yield* InteractiveMode;
    if (!mode.allow) {
      return yield* new BuildProfileError({
        message: `Multiple platforms available (${candidates.join(", ")}). Pass --platform explicitly when running non-interactively.`,
      });
    }
    return yield* promptSelect<Platform>(
      "Which platform to build?",
      candidates.map((entry) => ({ value: entry, label: entry })),
    );
  });
