import { asRecord } from "@better-update/type-guards";
import { Effect } from "effect";

import { BuildProfileError } from "./exit-codes";

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

const getBetterUpdateExtra = (
  appJson: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const expo = asRecord(appJson["expo"]);
  const extra = asRecord(expo?.["extra"]);
  return asRecord(extra?.["betterUpdate"]);
};

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
  appJson: Record<string, unknown>,
  profileName: string,
): Effect.Effect<BuildProfile, BuildProfileError> =>
  Effect.gen(function* () {
    const betterUpdate = getBetterUpdateExtra(appJson);
    const profiles = asRecord(betterUpdate?.["profiles"]);
    if (!profiles) {
      return yield* new BuildProfileError({
        message: "No build profiles defined. Add expo.extra.betterUpdate.profiles to app.json.",
      });
    }
    const profileRaw = asRecord(profiles[profileName]);
    if (!profileRaw) {
      return yield* new BuildProfileError({
        message: `Build profile "${profileName}" not found in app.json.`,
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

export const readRuntimeVersionMeta = (
  appJson: Record<string, unknown>,
): Effect.Effect<RuntimeVersionMeta, BuildProfileError> =>
  Effect.gen(function* () {
    const expo = asRecord(appJson["expo"]);
    if (!expo) {
      return yield* new BuildProfileError({
        message: "Missing expo section in app.json.",
      });
    }

    return {
      appVersion: asString(expo["version"]),
      rawRuntimeVersion: readRawRuntimeVersion(expo["runtimeVersion"]),
    };
  });

export const readAppMeta = (
  appJson: Record<string, unknown>,
  platform: Platform,
): Effect.Effect<AppMeta, BuildProfileError> =>
  Effect.gen(function* () {
    const expo = asRecord(appJson["expo"]);
    if (!expo) {
      return yield* new BuildProfileError({
        message: "Missing expo section in app.json.",
      });
    }

    if (platform === "ios") {
      const ios = asRecord(expo["ios"]);
      if (!ios) {
        return yield* new BuildProfileError({
          message:
            "Missing expo.ios section in app.json. Required for iOS builds (bundleIdentifier).",
        });
      }
    } else {
      const android = asRecord(expo["android"]);
      if (!android) {
        return yield* new BuildProfileError({
          message:
            "Missing expo.android section in app.json. Required for Android builds (package).",
        });
      }
    }

    const iosSection = asRecord(expo["ios"]);
    const androidSection = asRecord(expo["android"]);
    const buildNumber =
      platform === "ios"
        ? asString(iosSection?.["buildNumber"])
        : asStringOrNumber(androidSection?.["versionCode"]);
    return {
      bundleId: asString(iosSection?.["bundleIdentifier"]),
      androidPackage: asString(androidSection?.["package"]),
      appVersion: asString(expo["version"]),
      buildNumber,
      rawRuntimeVersion: readRawRuntimeVersion(expo["runtimeVersion"]),
    };
  });

const asStringOrNumber = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

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
