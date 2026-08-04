import { Effect } from "effect";

import { applyAutoIncrement } from "../lib/auto-increment";
import { readAppMeta, readExpoConfig } from "../lib/expo-config";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { resolveAppMeta } from "./resolve-app-meta";

import type { Platform } from "../lib/build-profile";
import type { AppMeta, BuildProfile } from "./platform-build";

/** App metadata plus the OTA runtime version recorded on the build. */
export interface BuildMeta {
  readonly appMeta: AppMeta;
  readonly runtimeVersion: string | undefined;
}

/**
 * Expo metadata path: read app.json (with the env overlay so dynamic configs
 * resolve), apply autoIncrement to the user's tree, re-read, then derive the OTA
 * runtimeVersion. Mirrors the original managed flow.
 *
 * The non-Expo counterpart is `resolveNativeBuildMeta`, which reads the same
 * shape out of the native files.
 */
export const resolveExpoBuildMeta = (params: {
  readonly userCwd: string;
  readonly platform: Platform;
  readonly profile: BuildProfile;
  readonly envVars: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const { userCwd, platform, profile, envVars } = params;
    const expoConfig = yield* readExpoConfig(userCwd, envVars);
    yield* applyAutoIncrement({
      projectRoot: userCwd,
      platform,
      config: expoConfig,
      ...(platform === "ios" && profile.ios?.autoIncrement !== undefined
        ? { iosMode: profile.ios.autoIncrement }
        : {}),
      ...(platform === "android" && profile.android?.autoIncrement !== undefined
        ? { androidMode: profile.android.autoIncrement }
        : {}),
    });
    const bumpedConfig = yield* readExpoConfig(userCwd, envVars);
    const expoAppMeta = yield* readAppMeta(bumpedConfig, platform);
    const appMeta = yield* resolveAppMeta({
      projectType: "expo",
      platform,
      projectRoot: userCwd,
      profile,
      expoAppMeta,
    });
    const runtimeVersion = yield* resolveRuntimeVersion({
      raw: appMeta.rawRuntimeVersion,
      appVersion: appMeta.appVersion,
      projectRoot: userCwd,
      platform,
      buildNumber: appMeta.buildNumber,
      sdkVersion: bumpedConfig.sdkVersion,
    });
    return { appMeta, runtimeVersion };
  });
