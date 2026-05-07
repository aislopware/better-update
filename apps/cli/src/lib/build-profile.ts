import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import { BuildProfileError } from "./exit-codes";

import type { ExpoConfig } from "./expo-config";

export type Platform = "ios" | "android";

export type IosDistribution = "app-store" | "ad-hoc" | "development" | "enterprise";

export interface IosProfile {
  readonly buildConfiguration?: string;
  readonly distribution: IosDistribution;
  readonly scheme?: string;
}

export type AndroidDistribution = "play-store" | "direct";

export interface AndroidProfile {
  readonly buildType?: "debug" | "release";
  readonly format: "apk" | "aab";
  readonly flavor?: string;
  readonly distribution: AndroidDistribution;
}

export interface BuildProfile {
  readonly name: string;
  readonly environment: string;
  readonly ios?: IosProfile;
  readonly android?: AndroidProfile;
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

const VALID_IOS_DISTRIBUTIONS: readonly IosDistribution[] = [
  "app-store",
  "ad-hoc",
  "development",
  "enterprise",
];

const isIosDistribution = (value: string): value is IosDistribution =>
  (VALID_IOS_DISTRIBUTIONS as readonly string[]).includes(value);

const readIosProfile = (raw: unknown): IosProfile | undefined => {
  const iosRaw = asRecord(raw);
  if (!iosRaw) {
    return undefined;
  }
  const distributionRaw = asString(iosRaw["distribution"]);
  if (!distributionRaw) {
    return undefined;
  }
  if (!isIosDistribution(distributionRaw)) {
    return undefined;
  }
  const distribution: IosDistribution = distributionRaw;
  const buildConfiguration = asString(iosRaw["buildConfiguration"]);
  const scheme = asString(iosRaw["scheme"]);
  return {
    distribution,
    ...(buildConfiguration === undefined ? {} : { buildConfiguration }),
    ...(scheme === undefined ? {} : { scheme }),
  };
};

const resolveAndroidDistribution = (
  raw: string | undefined,
  format: "apk" | "aab",
): AndroidDistribution => {
  if (raw === "play-store" || raw === "direct") {
    return raw;
  }
  return format === "aab" ? "play-store" : "direct";
};

const readAndroidProfile = (raw: unknown): AndroidProfile | undefined => {
  const androidRaw = asRecord(raw);
  if (!androidRaw) {
    return undefined;
  }
  const formatValue = asString(androidRaw["format"]);
  const format = formatValue === "apk" || formatValue === "aab" ? formatValue : undefined;
  if (!format) {
    return undefined;
  }
  const buildTypeValue = asString(androidRaw["buildType"]);
  const buildType =
    buildTypeValue === "debug" || buildTypeValue === "release" ? buildTypeValue : undefined;
  const flavor = asString(androidRaw["flavor"]);
  const distribution = resolveAndroidDistribution(asString(androidRaw["distribution"]), format);
  return {
    format,
    distribution,
    ...(buildType === undefined ? {} : { buildType }),
    ...(flavor === undefined ? {} : { flavor }),
  };
};

export const readBuildProfile = (
  config: ExpoConfig,
  profileName: string,
): Effect.Effect<BuildProfile, BuildProfileError> =>
  Effect.gen(function* () {
    const profiles = asRecord(config.extra?.betterUpdate?.profiles);
    if (!profiles) {
      return yield* new BuildProfileError({
        message: "No build profiles defined. Add extra.betterUpdate.profiles to your Expo config.",
      });
    }
    const profileRaw = asRecord(profiles[profileName]);
    if (!profileRaw) {
      return yield* new BuildProfileError({
        message: `Build profile "${profileName}" not found in your Expo config.`,
      });
    }
    const environment = asString(profileRaw["environment"]) ?? "production";
    const ios = readIosProfile(profileRaw["ios"]);
    const android = readAndroidProfile(profileRaw["android"]);
    return {
      name: profileName,
      environment,
      ...(ios === undefined ? {} : { ios }),
      ...(android === undefined ? {} : { android }),
    };
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
