import { capitalize } from "../../lib/string-utils";

import type { AndroidProfile } from "../../lib/build-profile";

/** An `.aab` profile ships a universal APK companion unless it opts out. */
export const wantsUniversalApk = (profile: AndroidProfile): boolean =>
  profile.format === "aab" && profile.universalApk !== false;

/**
 * Compose the Gradle task name from flavor, format, and buildType.
 *
 * Gradle naming convention: `<verb><Flavor><Variant>`, e.g.
 *   - no flavor + apk + release       → `assembleRelease`
 *   - no flavor + aab + release       → `bundleRelease`
 *   - flavor=prod + aab + release     → `bundleProdRelease`
 *   - flavor=prod + apk + debug       → `assembleProdDebug`
 */
export const gradleTaskName = (
  format: "apk" | "aab",
  flavor: string | undefined,
  buildType: "debug" | "release",
): string => {
  const verb = format === "aab" ? "bundle" : "assemble";
  return flavor
    ? `${verb}${capitalize(flavor)}${capitalize(buildType)}`
    : `${verb}${capitalize(buildType)}`;
};

/**
 * The Gradle task arguments for a profile, and whether they also assemble the
 * universal APK.
 *
 * - `gradleTask` (one task; a bare name runs in the profile's module) wins.
 * - else `gradleCommand` (EAS's field) is passed through as written, split on
 *   whitespace, exactly as EAS runs `./gradlew <gradleCommand>`: tasks are not
 *   module-prefixed, and flags are allowed.
 * - else the task is derived from format/flavor/buildType, and an `.aab` build
 *   assembles the universal APK in the SAME invocation: `bundleRelease
 *   assembleRelease` share every compile/dex/resource task, so the APK costs one
 *   packaging step, not a second build. An explicit task has no derivable
 *   assemble twin, so that case falls back to bundletool after the build.
 */
export const gradleTaskArgs = (
  profile: AndroidProfile,
): { readonly args: readonly string[]; readonly universalApkViaGradle: boolean } => {
  const buildType = profile.buildType ?? "release";
  const moduleName = profile.module ?? "app";
  const toTaskArg = (task: string) => (task.startsWith(":") ? task : `:${moduleName}:${task}`);
  if (profile.gradleTask !== undefined) {
    return { args: [toTaskArg(profile.gradleTask)], universalApkViaGradle: false };
  }
  const commandArgs = profile.gradleCommand?.split(/\s+/u).filter((arg) => arg !== "") ?? [];
  if (commandArgs.length > 0) {
    return { args: commandArgs, universalApkViaGradle: false };
  }
  const universalApkViaGradle = wantsUniversalApk(profile);
  return {
    args: [
      toTaskArg(gradleTaskName(profile.format, profile.flavor, buildType)),
      ...(universalApkViaGradle
        ? [toTaskArg(gradleTaskName("apk", profile.flavor, buildType))]
        : []),
    ],
    universalApkViaGradle,
  };
};
