import process from "node:process";

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
 * `envVars` are applied as a scoped overlay on `process.env` for the duration
 * of the call (restored afterwards) so dynamic configs (`app.config.js`)
 * can read them without leaking server-side secrets to child processes.
 *
 * Falls back to undefined if `@expo/config` is not available or fails.
 */
export const readExpoConfig = (
  projectRoot: string,
  envVars: Record<string, string> = {},
): Effect.Effect<ExpoConfig | undefined> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(envVars)) {
        previous[key] = process.env[key];
        process.env[key] = value;
      }
      return previous;
    }),
    () =>
      Effect.try({
        try: () => {
          const expoConfigCjs =
            // eslint-disable-next-line typescript/no-unsafe-type-assertion -- CJS require returns `any`; narrow to @expo/config's shape at this boundary
            require("@expo/config") as {
              getConfig: (
                projectRoot: string,
                options?: { skipSDKVersionRequirement?: boolean },
              ) => { exp: ExpoConfig };
            };
          const { getConfig } = expoConfigCjs;

          const { exp } = getConfig(projectRoot, {
            skipSDKVersionRequirement: true,
          });

          return exp;
        },
        catch: () => undefined,
      }).pipe(Effect.catchAll(() => Effect.succeed<ExpoConfig | undefined>(undefined))),
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) {
            // eslint-disable-next-line typescript/no-dynamic-delete -- restoring previous process.env snapshot; keys are arbitrary env var names we captured earlier
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }),
  );

const extractBuildNumber = (config: ExpoConfig, platform: Platform): string | undefined => {
  if (platform === "ios") {
    return config.ios?.buildNumber;
  }
  if (config.android?.versionCode === undefined) {
    return undefined;
  }
  return String(config.android.versionCode);
};

const extractRawRuntimeVersion = (config: ExpoConfig): RawRuntimeVersion | undefined => {
  if (typeof config.runtimeVersion === "string") {
    return config.runtimeVersion;
  }
  if (typeof config.runtimeVersion === "object") {
    return config.runtimeVersion;
  }
  return undefined;
};

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

    return {
      bundleId: config.ios?.bundleIdentifier,
      androidPackage: config.android?.package,
      appVersion: config.version,
      buildNumber: extractBuildNumber(config, platform),
      rawRuntimeVersion: extractRawRuntimeVersion(config),
    };
  });
