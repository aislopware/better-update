import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import type { FileSystem, Path } from "@effect/platform";

import { readEasJson, resolveEasBuildProfile } from "./eas-config";

import type { EasAndroidProfile, EasBuildProfile, EasIosProfile } from "./eas-config";
import type { BuildProfileError } from "./exit-codes";
import type { ExpoConfig } from "./expo-config";

export type Platform = "ios" | "android";

export type IosDistribution = "app-store" | "ad-hoc" | "development" | "enterprise";

export interface IosProfile {
  readonly buildConfiguration?: string;
  readonly distribution: IosDistribution;
  readonly scheme?: string;
  readonly simulator?: boolean;
}

export type AndroidDistribution = "play-store" | "direct";

export interface AndroidProfile {
  readonly buildType?: "debug" | "release";
  readonly format: "apk" | "aab";
  readonly flavor?: string;
  readonly distribution: AndroidDistribution;
  readonly gradleCommand?: string;
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

const toIosProfile = (eas: EasBuildProfile): IosProfile | undefined => {
  if (!hasIosIntent(eas)) {
    return undefined;
  }
  const distribution = deriveIosDistribution(eas);
  if (!distribution) {
    return undefined;
  }
  const ios: EasIosProfile = eas.ios ?? {};
  return {
    distribution,
    ...(ios.buildConfiguration === undefined ? {} : { buildConfiguration: ios.buildConfiguration }),
    ...(ios.scheme === undefined ? {} : { scheme: ios.scheme }),
    ...(ios.simulator === undefined ? {} : { simulator: ios.simulator }),
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
  return {
    format,
    distribution,
    ...(android.buildType === undefined ? {} : { buildType: android.buildType }),
    ...(android.flavor === undefined ? {} : { flavor: android.flavor }),
    ...(android.gradleCommand === undefined ? {} : { gradleCommand: android.gradleCommand }),
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
