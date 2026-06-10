import { compact } from "@better-update/type-guards";
import { Effect } from "effect";

import type { FileSystem } from "@effect/platform";

import { readEasJson, resolveEasBuildProfile } from "./eas-config";
import { extractAppVersion, extractBuildNumber, extractRawRuntimeVersion } from "./expo-config";

import type {
  CustomCommandProfile,
  EasAndroidProfile,
  EasBuildProfile,
  EasIosProfile,
} from "./eas-config";
import type { BuildProfileError } from "./exit-codes";
import type { ExpoConfig } from "./expo-config";

export type Platform = "ios" | "android";

export type IosDistribution = "app-store" | "ad-hoc" | "development" | "enterprise";

export type IosAutoIncrement = "buildNumber" | "version";
export type AndroidAutoIncrement = "versionCode" | "version";

/** Metadata overrides read from the profile when native config is unavailable. */
export interface IosMetaOverride {
  readonly bundleIdentifier?: string;
  readonly version?: string;
  readonly buildNumber?: string;
}

export interface IosProfile {
  readonly buildConfiguration?: string;
  readonly distribution: IosDistribution;
  readonly scheme?: string;
  readonly simulator?: boolean;
  readonly autoIncrement?: IosAutoIncrement;
  /** Explicit `.xcworkspace` path (relative to project root). Else auto-discover. */
  readonly workspace?: string;
  /** Explicit `.xcodeproj` path when there is no workspace (pure-native apps). */
  readonly project?: string;
  /** Run `pod install` before xcodebuild. Defaults to true when a Podfile exists. */
  readonly podInstall?: boolean;
  readonly metaOverride?: IosMetaOverride;
}

export type AndroidDistribution = "play-store" | "direct";

export interface AndroidMetaOverride {
  readonly applicationId?: string;
  readonly version?: string;
  readonly versionCode?: string;
}

export interface AndroidProfile {
  readonly buildType?: "debug" | "release";
  readonly format: "apk" | "aab";
  readonly flavor?: string;
  readonly distribution: AndroidDistribution;
  readonly gradleCommand?: string;
  readonly autoIncrement?: AndroidAutoIncrement;
  /** Gradle module that produces the artifact. Default "app". */
  readonly module?: string;
  /** Explicit Gradle task, overrides format/flavor/buildType derivation. */
  readonly gradleTask?: string;
  readonly metaOverride?: AndroidMetaOverride;
}

export type CredentialsSource = "remote" | "local";

export interface BuildProfile {
  readonly name: string;
  readonly environment: string;
  readonly channel?: string;
  readonly env?: Record<string, string>;
  readonly ios?: IosProfile;
  readonly android?: AndroidProfile;
  readonly credentialsSource?: CredentialsSource;
  /** Mirror of EAS `developmentClient` — drives Debug/debug variant + dev-client validation. */
  readonly developmentClient?: boolean;
  /** Mirror of EAS `withoutCredentials` — skip credential fetch + signing injection. */
  readonly withoutCredentials?: boolean;
  /** Custom-command escape hatch (per platform) — overrides native build invocation. */
  readonly customCommand?: CustomCommandProfile;
}

export type RawRuntimeVersion = string | { readonly policy: string };

export interface AppMeta {
  readonly bundleId: string | undefined;
  readonly androidPackage: string | undefined;
  readonly appVersion: string | undefined;
  readonly buildNumber: string | undefined;
  readonly rawRuntimeVersion: RawRuntimeVersion | undefined;
}

export interface RuntimeVersionMeta {
  readonly platform: Platform;
  readonly appVersion: string | undefined;
  /** Per-platform native version slot: ios.buildNumber / String(android.versionCode). */
  readonly buildNumber: string | undefined;
  /** `expo.sdkVersion` when present in the resolved config (often undefined). */
  readonly sdkVersion: string | undefined;
  readonly rawRuntimeVersion: RawRuntimeVersion | undefined;
}

const deriveIosDistribution = (eas: EasBuildProfile): IosDistribution | undefined => {
  const override = eas.ios?.distribution;
  if (override) {
    return override;
  }
  if (eas.developmentClient === true) {
    return "development";
  }
  if (eas.distribution === "internal") {
    return "ad-hoc";
  }
  if (eas.distribution === "store") {
    return "app-store";
  }
  return undefined;
};

const deriveAndroidFormat = (eas: EasBuildProfile): "apk" | "aab" | undefined => {
  if (eas.android?.format) {
    return eas.android.format;
  }
  if (eas.distribution === "store") {
    return "aab";
  }
  if (eas.distribution === "internal") {
    return "apk";
  }
  if (eas.developmentClient === true) {
    return "apk";
  }
  return undefined;
};

const deriveAndroidDistribution = (
  eas: EasBuildProfile,
  format: "apk" | "aab",
): AndroidDistribution => {
  if (eas.android?.distribution) {
    return eas.android.distribution;
  }
  if (format === "aab") {
    return "play-store";
  }
  return "direct";
};

const hasIosIntent = (eas: EasBuildProfile): boolean =>
  eas.ios !== undefined || eas.distribution !== undefined || eas.developmentClient === true;

const hasAndroidIntent = (eas: EasBuildProfile): boolean =>
  eas.android !== undefined || eas.distribution !== undefined || eas.developmentClient === true;

const resolveIosAutoIncrement = (eas: EasBuildProfile): IosAutoIncrement | undefined => {
  const override = eas.ios?.autoIncrement;
  if (override === false) {
    return undefined;
  }
  if (override === true) {
    return "buildNumber";
  }
  if (override === "buildNumber" || override === "version") {
    return override;
  }
  const top = eas.autoIncrement;
  if (top === true || top === "buildNumber") {
    return "buildNumber";
  }
  if (top === "version") {
    return "version";
  }
  return undefined;
};

const resolveAndroidAutoIncrement = (eas: EasBuildProfile): AndroidAutoIncrement | undefined => {
  const override = eas.android?.autoIncrement;
  if (override === false) {
    return undefined;
  }
  if (override === true) {
    return "versionCode";
  }
  if (override === "versionCode" || override === "version") {
    return override;
  }
  const top = eas.autoIncrement;
  if (top === true || top === "versionCode") {
    return "versionCode";
  }
  if (top === "version") {
    return "version";
  }
  return undefined;
};

const toIosProfile = (eas: EasBuildProfile): IosProfile | undefined => {
  if (!hasIosIntent(eas)) {
    return undefined;
  }
  const distribution = deriveIosDistribution(eas);
  if (!distribution) {
    return undefined;
  }
  const ios: EasIosProfile = eas.ios ?? {};
  const autoIncrement = resolveIosAutoIncrement(eas);
  // EAS parity: `developmentClient: true` forces Xcode `Debug` configuration
  // (matches eas-build-job/src/ios.ts resolveBuildConfiguration). An explicit
  // ios.buildConfiguration override always wins.
  const buildConfiguration =
    ios.buildConfiguration ?? (eas.developmentClient === true ? "Debug" : undefined);
  const metaOverride = compact({
    bundleIdentifier: ios.bundleIdentifier,
    version: ios.version,
    buildNumber: ios.buildNumber,
  });
  return compact({
    distribution,
    buildConfiguration,
    scheme: ios.scheme,
    simulator: ios.simulator,
    autoIncrement,
    workspace: ios.workspace,
    project: ios.project,
    podInstall: ios.podInstall,
    metaOverride: Object.keys(metaOverride).length === 0 ? undefined : metaOverride,
  });
};

const toAndroidProfile = (eas: EasBuildProfile): AndroidProfile | undefined => {
  if (!hasAndroidIntent(eas)) {
    return undefined;
  }
  const format = deriveAndroidFormat(eas);
  if (!format) {
    return undefined;
  }
  const android: EasAndroidProfile = eas.android ?? {};
  const distribution = deriveAndroidDistribution(eas, format);
  const autoIncrement = resolveAndroidAutoIncrement(eas);
  // EAS parity: `developmentClient: true` forces Gradle debug variant (matches
  // eas-build-job/src/android.ts resolveGradleCommand). An explicit
  // android.buildType override always wins.
  const buildType =
    android.buildType ?? (eas.developmentClient === true ? ("debug" as const) : undefined);
  const metaOverride = compact({
    applicationId: android.applicationId,
    version: android.version,
    versionCode: android.versionCode,
  });
  return compact({
    format,
    distribution,
    buildType,
    flavor: android.flavor,
    gradleCommand: android.gradleCommand,
    autoIncrement,
    module: android.module,
    gradleTask: android.gradleTask,
    metaOverride: Object.keys(metaOverride).length === 0 ? undefined : metaOverride,
  });
};

export const fromGenericProfile = (eas: EasBuildProfile, profileName: string): BuildProfile => {
  const ios = toIosProfile(eas);
  const android = toAndroidProfile(eas);
  return compact({
    name: profileName,
    environment: eas.environment ?? "production",
    channel: eas.channel,
    env: eas.env,
    ios,
    android,
    credentialsSource: eas.credentialsSource,
    developmentClient: eas.developmentClient,
    withoutCredentials: eas.withoutCredentials,
    customCommand: eas.custom,
  });
};

/** Resolve a build profile from `eas.json`'s `build` section (all build systems). */
export const readBuildProfile = (
  projectRoot: string,
  profileName: string,
): Effect.Effect<BuildProfile, BuildProfileError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const config = yield* readEasJson(projectRoot);
    const profile = yield* resolveEasBuildProfile(config, profileName, "eas.json");
    return fromGenericProfile(profile, profileName);
  });

export const readRuntimeVersionMeta = (
  config: ExpoConfig,
  platform: Platform,
): RuntimeVersionMeta => ({
  platform,
  appVersion: extractAppVersion(config, platform),
  buildNumber: extractBuildNumber(config, platform),
  sdkVersion: config.sdkVersion,
  rawRuntimeVersion: extractRawRuntimeVersion(config, platform),
});
