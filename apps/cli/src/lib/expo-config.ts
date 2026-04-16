import { Effect } from "effect";

import { BuildProfileError } from "./exit-codes";

import type { AppMeta, Platform, RawRuntimeVersion } from "./build-profile";

interface ExpoConfig {
  readonly name?: string;
  readonly slug?: string;
  readonly version?: string;
  readonly runtimeVersion?: string | { readonly policy: string };
  readonly ios?: {
    readonly bundleIdentifier?: string;
    readonly buildNumber?: string;
  };
  readonly android?: {
    readonly package?: string;
    readonly versionCode?: number;
  };
  readonly [key: string]: unknown;
}

/**
 * Resolve the full Expo config using `@expo/config`, which handles
 * `app.json`, `app.config.js`, and `app.config.ts` with plugin evaluation.
 *
 * Falls back to undefined if `@expo/config` is not available or fails.
 */
export const readExpoConfig = (projectRoot: string): Effect.Effect<ExpoConfig | undefined> =>
  Effect.try({
    try: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- @expo/config is CJS
      const { getConfig } = require("@expo/config") as {
        getConfig: (
          projectRoot: string,
          options?: { skipSDKVersionRequirement?: boolean },
        ) => { exp: ExpoConfig };
      };

      const { exp } = getConfig(projectRoot, {
        skipSDKVersionRequirement: true,
      });

      return exp;
    },
    catch: () => undefined,
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

/**
 * Extract AppMeta from a resolved ExpoConfig (from `@expo/config`).
 * Mirrors `readAppMeta` from build-profile.ts but uses the resolved config
 * which handles dynamic configs (`app.config.js`, `app.config.ts`).
 */
export const readAppMetaFromConfig = (
  config: ExpoConfig,
  platform: Platform,
): Effect.Effect<AppMeta, BuildProfileError> =>
  Effect.gen(function* () {
    if (platform === "ios" && !config.ios) {
      return yield* new BuildProfileError({
        message: "Missing expo.ios section in config. Required for iOS builds (bundleIdentifier).",
      });
    }
    if (platform === "android" && !config.android) {
      return yield* new BuildProfileError({
        message: "Missing expo.android section in config. Required for Android builds (package).",
      });
    }

    const buildNumber =
      platform === "ios"
        ? config.ios?.buildNumber
        : config.android?.versionCode !== undefined
          ? String(config.android.versionCode)
          : undefined;

    const rawRuntimeVersion: RawRuntimeVersion | undefined =
      typeof config.runtimeVersion === "string"
        ? config.runtimeVersion
        : typeof config.runtimeVersion === "object" && config.runtimeVersion !== null
          ? config.runtimeVersion
          : undefined;

    return {
      bundleId: config.ios?.bundleIdentifier,
      androidPackage: config.android?.package,
      appVersion: config.version,
      buildNumber,
      rawRuntimeVersion,
    };
  });
