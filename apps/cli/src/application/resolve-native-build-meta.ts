import { Effect } from "effect";

import { hasAnyExpoConfigFile } from "../lib/detect-project-type";
import { extractRawRuntimeVersion, readExpoConfig } from "../lib/expo-config";
import { formatCause } from "../lib/format-error";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { printWarn } from "../lib/warning-style";
import { resolveAppMeta } from "./resolve-app-meta";

import type { Platform } from "../lib/build-profile";
import type { ProjectType } from "../lib/detect-project-type";
import type { BuildProfile } from "./platform-build";

/**
 * Non-Expo metadata path (bare / native / kmp / custom).
 *
 * App metadata still comes from the native files and profile overrides — that
 * part is unchanged. What IS new: the OTA runtimeVersion is derived whenever an
 * Expo config is present, instead of being hard-coded to `undefined`.
 *
 * The old code assumed "not an Expo project" implied "no expo-updates", which
 * is false: a bare React Native app can depend on expo-updates and commit its
 * own `ios/` + `android/` precisely to avoid prebuild. Those builds uploaded a
 * record with an empty runtime version, which made
 * `builds compatibility-matrix` report "No compatibility data found" and left
 * operators with no way to check update/binary compatibility before publishing.
 *
 * Deliberately best-effort: a project that merely happens to have an app.json
 * must not start FAILING its builds because that file is unreadable or carries
 * no runtimeVersion. Both cases fall back to `undefined`, i.e. exactly the old
 * behaviour; only the readable-and-configured case gains a value. Note the
 * asymmetry with the Expo path, which errors on a missing runtimeVersion —
 * there it is a genuine misconfiguration, here it is the norm.
 *
 * autoIncrement is NOT applied here: it is a read-modify-write of app.json, and
 * on these project types the version of record lives in the native files.
 */
export const resolveNativeBuildMeta = (params: {
  readonly userCwd: string;
  readonly platform: Platform;
  readonly profile: BuildProfile;
  readonly projectType: ProjectType;
  readonly envVars: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const { userCwd, platform, profile, projectType, envVars } = params;
    const appMeta = yield* resolveAppMeta({
      projectType,
      platform,
      projectRoot: userCwd,
      profile,
    });
    if (!(yield* hasAnyExpoConfigFile(userCwd))) {
      return { appMeta, runtimeVersion: undefined };
    }
    const expoConfig = yield* readExpoConfig(userCwd, envVars).pipe(
      Effect.catchAll((cause) =>
        printWarn(
          `Found an Expo config but could not read it, so no OTA runtimeVersion will be recorded for this build: ${formatCause(cause)}`,
        ).pipe(Effect.as(undefined)),
      ),
    );
    if (expoConfig === undefined) {
      return { appMeta, runtimeVersion: undefined };
    }
    const raw = extractRawRuntimeVersion(expoConfig, platform);
    if (raw === undefined) {
      return { appMeta, runtimeVersion: undefined };
    }
    const runtimeVersion = yield* resolveRuntimeVersion({
      raw,
      appVersion: appMeta.appVersion,
      projectRoot: userCwd,
      platform,
      buildNumber: appMeta.buildNumber,
      sdkVersion: expoConfig.sdkVersion,
    });
    return { appMeta, runtimeVersion };
  });
