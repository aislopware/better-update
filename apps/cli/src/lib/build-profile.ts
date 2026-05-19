import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import type { FileSystem, Path } from "@effect/platform";

import { readEasJson, resolveEasBuildProfile } from "./eas-config";

import type { EasAndroidProfile, EasBuildProfile, EasIosProfile } from "./eas-config";
import type { BuildProfileError } from "./exit-codes";
import type { ExpoConfig } from "./expo-config";

export type Platform = "ios" | "android";

export type IosDistribution = "app-store" | "ad-hoc" | "development" | "enterprise";

export type IosAutoIncrement = "buildNumber" | "version";
export type AndroidAutoIncrement = "versionCode" | "version";

export interface IosProfile {
  readonly buildConfiguration?: string;
  readonly distribution: IosDistribution;
  readonly scheme?: string;
  readonly simulator?: boolean;
  readonly autoIncrement?: IosAutoIncrement;
}

export type AndroidDistribution = "play-store" | "direct";

export interface AndroidProfile {
  readonly buildType?: "debug" | "release";
  readonly format: "apk" | "aab";
  readonly flavor?: string;
  readonly distribution: AndroidDistribution;
  readonly gradleCommand?: string;
  readonly autoIncrement?: AndroidAutoIncrement;
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
  readonly appVersion: string | undefined;
  readonly rawRuntimeVersion: RawRuntimeVersion | undefined;
}

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

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
  return {
    distribution,
    ...(buildConfiguration === undefined ? {} : { buildConfiguration }),
    ...(ios.scheme === undefined ? {} : { scheme: ios.scheme }),
    ...(ios.simulator === undefined ? {} : { simulator: ios.simulator }),
    ...(autoIncrement === undefined ? {} : { autoIncrement }),
  };
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
  return {
    format,
    distribution,
    ...(buildType === undefined ? {} : { buildType }),
    ...(android.flavor === undefined ? {} : { flavor: android.flavor }),
    ...(android.gradleCommand === undefined ? {} : { gradleCommand: android.gradleCommand }),
    ...(autoIncrement === undefined ? {} : { autoIncrement }),
  };
};

export const fromEasProfile = (eas: EasBuildProfile, profileName: string): BuildProfile => {
  const ios = toIosProfile(eas);
  const android = toAndroidProfile(eas);
  return {
    name: profileName,
    environment: eas.environment ?? "production",
    ...(eas.channel === undefined ? {} : { channel: eas.channel }),
    ...(eas.env === undefined ? {} : { env: eas.env }),
    ...(ios === undefined ? {} : { ios }),
    ...(android === undefined ? {} : { android }),
    ...(eas.credentialsSource === undefined ? {} : { credentialsSource: eas.credentialsSource }),
    ...(eas.developmentClient === undefined ? {} : { developmentClient: eas.developmentClient }),
    ...(eas.withoutCredentials === undefined ? {} : { withoutCredentials: eas.withoutCredentials }),
  };
};

export const readBuildProfile = (
  projectRoot: string,
  profileName: string,
): Effect.Effect<BuildProfile, BuildProfileError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const config = yield* readEasJson(projectRoot);
    const easProfile = yield* resolveEasBuildProfile(config, profileName);
    return fromEasProfile(easProfile, profileName);
  });

export const readRuntimeVersionMeta = (config: ExpoConfig): RuntimeVersionMeta => ({
  appVersion: config.version,
  rawRuntimeVersion: readRawRuntimeVersion(config.runtimeVersion),
});

const readRawRuntimeVersion = (value: unknown): RawRuntimeVersion | undefined => {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  const policy = asString(record?.["policy"]);
  if (policy) {
    return { policy };
  }
  return undefined;
};
