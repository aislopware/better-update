import { Effect } from "effect";

import type { CommandExecutor, FileSystem } from "@effect/platform";

import { RuntimeVersionError } from "./exit-codes";
import { resolveInstalledExpoSdkVersion } from "./expo-config";
import { runFingerprintForPlatform } from "./fingerprint";

import type { Platform, RawRuntimeVersion } from "./build-profile";

export interface ResolveRuntimeVersionOptions {
  readonly raw: RawRuntimeVersion | undefined;
  readonly appVersion: string | undefined;
  readonly projectRoot: string;
  readonly platform: Platform;
  /** Per-platform native version: ios.buildNumber / String(android.versionCode). */
  readonly buildNumber: string | undefined;
  /** `expo.sdkVersion` from the resolved config; falls back to the installed expo. */
  readonly sdkVersion: string | undefined;
}

/**
 * EAS defaults a missing app version to `1.0.0` and a missing native build
 * number / version code to `1` (`@expo/config-plugins` `getAppVersion`,
 * `getVersion`, `getBuildNumber`, `getVersionCode`). Mirror those so a managed
 * app with `{policy:"appVersion"|"nativeVersion"}` and no explicit
 * version/buildNumber resolves to the same RTV the device build stamps in,
 * rather than hard-erroring and blocking the publish.
 */
const DEFAULT_APP_VERSION = "1.0.0";
const DEFAULT_BUILD_NUMBER = "1";

/**
 * Resolve an Expo `runtimeVersion` to the literal string the device sends and
 * the server matches updates against. Supports all four EAS policies plus a
 * static string:
 *
 * - static string: passed through unchanged.
 * - `appVersion`: `expo.version`, defaulting to `1.0.0` (matching
 *   `@expo/config-plugins` `getAppVersion`).
 * - `nativeVersion`: `${expo.version}(${buildNumber})` — parentheses included,
 *   matching `@expo/config-plugins` `getNativeVersion`; `buildNumber` is
 *   per-platform (ios.buildNumber / android.versionCode), and EAS's defaults
 *   apply (version `1.0.0`, buildNumber/versionCode `1`).
 * - `sdkVersion`: `exposdk:${sdk}` (matching `@expo/sdk-runtime-versions`),
 *   where `sdk` is `expo.sdkVersion` reduced to `${major}.0.0` or, when absent,
 *   the installed expo package version reduced the same way.
 * - `fingerprint`: the `@expo/fingerprint` hash (the hash IS the runtimeVersion).
 */
export const resolveRuntimeVersion = ({
  raw,
  appVersion,
  projectRoot,
  platform,
  buildNumber,
  sdkVersion,
}: ResolveRuntimeVersionOptions): Effect.Effect<
  string,
  RuntimeVersionError,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (typeof raw === "string") {
      return raw;
    }
    if (raw === undefined) {
      return yield* new RuntimeVersionError({
        message: "No runtimeVersion configured in expo section of app.json.",
      });
    }

    const { policy } = raw;
    if (policy === "appVersion") {
      // EAS `getAppVersion`: `config.version ?? '1.0.0'`.
      return appVersion ?? DEFAULT_APP_VERSION;
    }

    if (policy === "nativeVersion") {
      // EAS `getNativeVersion`: `${version}(${buildNumber|versionCode})` with
      // version defaulting to `1.0.0` and buildNumber/versionCode to `1`.
      return `${appVersion ?? DEFAULT_APP_VERSION}(${buildNumber ?? DEFAULT_BUILD_NUMBER})`;
    }

    if (policy === "sdkVersion") {
      const sdk = sdkVersion ?? (yield* resolveInstalledExpoSdkVersion(projectRoot));
      if (sdk === undefined) {
        return yield* new RuntimeVersionError({
          message:
            'runtimeVersion policy "sdkVersion": could not resolve Expo SDK version (no sdkVersion in app config and expo not installed).',
        });
      }
      return `exposdk:${sdk}`;
    }

    if (policy === "fingerprint") {
      // Per-platform fingerprint (matching EAS) — the hash IS the runtimeVersion
      // the device matches against, so a combined-platform hash would never be
      // delivered. `runFingerprintForPlatform` threads `--platform` + the managed
      // `--ignore-path` filters.
      return yield* runFingerprintForPlatform(projectRoot, platform).pipe(
        Effect.map((result) => result.hash),
        Effect.mapError((cause) => new RuntimeVersionError({ message: cause.message })),
      );
    }

    return yield* new RuntimeVersionError({
      message: `Unsupported runtimeVersion policy "${policy}". Use a static string, "appVersion", "nativeVersion", "sdkVersion", or "fingerprint".`,
    });
  });
