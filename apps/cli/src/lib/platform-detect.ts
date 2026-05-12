import { Effect } from "effect";

import { BuildProfileError } from "./exit-codes";
import { InteractiveMode } from "./interactive-mode";
import { promptSelect } from "./prompts";

import type { Platform } from "./build-profile";
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
 * config (`expo.platforms` or the presence of `ios`/`android` sections). Prompts
 * when the config declares both platforms; fails when ambiguous and prompts are
 * disallowed.
 */
export const detectPlatform = (
  explicit: Platform | undefined,
  config: ExpoConfig,
): Effect.Effect<Platform, BuildProfileError | InteractiveProhibitedError, InteractiveMode> =>
  Effect.gen(function* () {
    if (explicit !== undefined) {
      return explicit;
    }
    const candidates = inferPlatforms(config);
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
