import path from "node:path";

import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";

import { BuildProfileError } from "../lib/exit-codes";
import { readGradleConfig } from "../lib/gradle-config";
import { readIosNativeMeta } from "../lib/ios-native-meta";
import { printWarn } from "../lib/warning-style";

import type { AppMeta, BuildProfile, Platform } from "../lib/build-profile";
import type { ProjectType } from "../lib/detect-project-type";
import type { ExpoConfig } from "../lib/expo-config";
import type { IosNativeMeta } from "../lib/ios-native-meta";
import type { OutputMode } from "../lib/output-mode";

const EMPTY: AppMeta = {
  bundleId: undefined,
  androidPackage: undefined,
  appVersion: undefined,
  buildNumber: undefined,
  rawRuntimeVersion: undefined,
};

const warnIfMismatch = (label: string, override: string | undefined, native: string | undefined) =>
  override !== undefined && native !== undefined && override !== native
    ? printWarn(
        `${label} override "${override}" differs from the native value "${native}". ` +
          "The eas.json value will be used for build metadata.",
      )
    : Effect.void;

const resolveAndroidMeta = (projectRoot: string, profile: BuildProfile) =>
  Effect.gen(function* () {
    const gradle = yield* readGradleConfig(path.join(projectRoot, "android"));
    const override = profile.android?.metaOverride;
    yield* warnIfMismatch("android.applicationId", override?.applicationId, gradle?.applicationId);

    const androidPackage = override?.applicationId ?? gradle?.applicationId;
    if (androidPackage === undefined) {
      return yield* new BuildProfileError({
        message:
          "Could not determine the Android applicationId. Set android.applicationId under this " +
          "build profile in eas.json, or ensure android/app/build.gradle defines it.",
      });
    }
    const versionCode =
      override?.versionCode ??
      (gradle?.versionCode === undefined ? undefined : String(gradle.versionCode));
    return {
      ...EMPTY,
      androidPackage,
      appVersion: override?.version ?? gradle?.versionName,
      buildNumber: versionCode,
    } satisfies AppMeta;
  });

const resolveIosMeta = (projectRoot: string, profile: BuildProfile) =>
  Effect.gen(function* () {
    const configurationName = profile.ios?.buildConfiguration ?? "Release";
    const native = yield* readIosNativeMeta({
      iosDir: path.join(projectRoot, "ios"),
      configurationName,
    }).pipe(Effect.orElseSucceed((): IosNativeMeta => ({})));
    const override = profile.ios?.metaOverride;
    yield* warnIfMismatch("ios.bundleIdentifier", override?.bundleIdentifier, native.bundleId);

    const bundleId = override?.bundleIdentifier ?? native.bundleId;
    if (bundleId === undefined) {
      return yield* new BuildProfileError({
        message:
          "Could not determine the iOS bundle identifier. Set ios.bundleIdentifier under this " +
          "build profile in eas.json, or ensure the Xcode project defines " +
          "PRODUCT_BUNDLE_IDENTIFIER for the build configuration.",
      });
    }
    return {
      ...EMPTY,
      bundleId,
      appVersion: override?.version ?? native.marketingVersion,
      buildNumber: override?.buildNumber ?? native.currentProjectVersion,
    } satisfies AppMeta;
  });

const overlayExpoOverride = (meta: AppMeta, platform: Platform, profile: BuildProfile): AppMeta => {
  if (platform === "ios") {
    const override = profile.ios?.metaOverride;
    return {
      ...meta,
      bundleId: override?.bundleIdentifier ?? meta.bundleId,
      appVersion: override?.version ?? meta.appVersion,
      buildNumber: override?.buildNumber ?? meta.buildNumber,
    };
  }
  const override = profile.android?.metaOverride;
  return {
    ...meta,
    androidPackage: override?.applicationId ?? meta.androidPackage,
    appVersion: override?.version ?? meta.appVersion,
    buildNumber: override?.versionCode ?? meta.buildNumber,
  };
};

export interface ResolveAppMetaParams {
  readonly projectType: ProjectType;
  readonly platform: Platform;
  readonly projectRoot: string;
  readonly profile: BuildProfile;
  /** Resolved Expo config, required only for `projectType === "expo"`. */
  readonly expoConfig?: ExpoConfig | undefined;
  /** Pre-read Expo AppMeta (already validated), used for the expo path. */
  readonly expoAppMeta?: AppMeta | undefined;
}

/**
 * Resolve app metadata (bundle id / package, version, build number) in a
 * project-type-aware way. Expo reads from app.json; bare/native read from native
 * files (build.gradle / pbxproj); KMP/custom rely on profile `metaOverride`,
 * which also overrides native values when both are present.
 */
export const resolveAppMeta = (
  params: ResolveAppMetaParams,
): Effect.Effect<AppMeta, BuildProfileError, FileSystem.FileSystem | OutputMode> => {
  if (params.projectType === "expo") {
    if (params.expoAppMeta === undefined) {
      return Effect.fail(
        new BuildProfileError({ message: "Internal: missing Expo app metadata for expo project." }),
      );
    }
    return Effect.succeed(overlayExpoOverride(params.expoAppMeta, params.platform, params.profile));
  }
  return params.platform === "ios"
    ? resolveIosMeta(params.projectRoot, params.profile)
    : resolveAndroidMeta(params.projectRoot, params.profile);
};
