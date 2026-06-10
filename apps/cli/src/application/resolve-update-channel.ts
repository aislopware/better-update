import { Effect } from "effect";

import { resolveAndroidStrategy, resolveIosStrategy } from "../lib/build-strategy";
import { BuildProfileError } from "../lib/exit-codes";
import { printHuman } from "../lib/output";
import { isExpoUpdatesInstalled } from "../lib/update-channel-native";

import type { BuildProfile, Platform } from "../lib/build-profile";
import type { ProjectType } from "../lib/detect-project-type";

/**
 * EAS parity: bake the profile's channel into the native app as the
 * expo-channel-name request header during prebuild. Only the managed ("expo")
 * strategy prebuilds, and only apps shipping expo-updates read the header — a
 * binary built without it silently falls back to the server's default channel,
 * so a missing `channel` on an updates-enabled profile fails fast instead.
 * Returns the channel to inject, or `undefined` to skip injection.
 */
export const resolveUpdateChannel = (params: {
  readonly userCwd: string;
  readonly platform: Platform;
  readonly profile: BuildProfile;
  readonly projectType: ProjectType;
}) =>
  Effect.gen(function* () {
    const { userCwd, platform, profile, projectType } = params;
    const strategy =
      platform === "ios"
        ? resolveIosStrategy(profile, projectType)
        : resolveAndroidStrategy(profile, projectType);
    if (strategy !== "expo") {
      return undefined;
    }
    if (!(yield* isExpoUpdatesInstalled(userCwd))) {
      yield* printHuman("expo-updates is not installed — skipping update-channel injection.");
      return undefined;
    }
    if (profile.channel === undefined) {
      return yield* new BuildProfileError({
        message: `Build profile "${profile.name}" has no "channel". The channel is baked into the binary as the expo-channel-name update request header; add e.g. "channel": "production" to the profile.`,
      });
    }
    return profile.channel;
  });
