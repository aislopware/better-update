import { asRecord } from "@better-update/type-guards";
import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";

import { parseSubmitProfile } from "./eas-submit-config";
import { BuildProfileError } from "./exit-codes";
import { formatCause } from "./format-error";

import type { EasSubmitProfile } from "./eas-submit-config";

export type EasDistribution = "internal" | "store";

export type EasIosDistributionOverride = "app-store" | "ad-hoc" | "development" | "enterprise";

export type EasIosAutoIncrement = boolean | "buildNumber" | "version";
export type EasAndroidAutoIncrement = boolean | "versionCode" | "version";
export type EasAutoIncrement = boolean | "buildNumber" | "versionCode" | "version";

export interface EasIosProfile {
  readonly distribution?: EasIosDistributionOverride;
  readonly buildConfiguration?: string;
  readonly scheme?: string;
  readonly simulator?: boolean;
  readonly enterpriseProvisioning?: "adhoc" | "universal";
  readonly autoIncrement?: EasIosAutoIncrement;
}

export interface EasAndroidProfile {
  readonly buildType?: "debug" | "release";
  readonly flavor?: string;
  readonly gradleCommand?: string;
  readonly format?: "apk" | "aab";
  readonly distribution?: "play-store" | "direct";
  readonly autoIncrement?: EasAndroidAutoIncrement;
}

export type EasCredentialsSource = "remote" | "local";

export interface EasBuildProfile {
  readonly extends?: string;
  readonly developmentClient?: boolean;
  readonly distribution?: EasDistribution;
  readonly channel?: string;
  readonly environment?: string;
  readonly env?: Record<string, string>;
  readonly ios?: EasIosProfile;
  readonly android?: EasAndroidProfile;
  readonly credentialsSource?: EasCredentialsSource;
  readonly autoIncrement?: EasAutoIncrement;
  readonly withoutCredentials?: boolean;
}

export type {
  EasAndroidSubmitProfile,
  EasAndroidSubmitReleaseStatus,
  EasIosSubmitProfile,
  EasSubmitProfile,
} from "./eas-submit-config";
export { resolveEasSubmitProfile } from "./eas-submit-config";

export interface EasConfig {
  readonly cli?: { readonly version?: string };
  readonly build?: Record<string, EasBuildProfile>;
  readonly submit?: Record<string, EasSubmitProfile>;
}

const MAX_EXTENDS_DEPTH = 10;

const asStringValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asBooleanValue = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asEnv = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "string") {
      env[key] = raw;
    }
  }
  return Object.keys(env).length === 0 ? undefined : env;
};

const asIosDistribution = (raw: unknown): EasIosDistributionOverride | undefined => {
  const value = asStringValue(raw);
  if (
    value === "app-store" ||
    value === "ad-hoc" ||
    value === "development" ||
    value === "enterprise"
  ) {
    return value;
  }
  return undefined;
};

const asEnterpriseProvisioning = (raw: unknown): "adhoc" | "universal" | undefined => {
  const value = asStringValue(raw);
  return value === "adhoc" || value === "universal" ? value : undefined;
};

const asAndroidBuildType = (raw: unknown): "debug" | "release" | undefined => {
  const value = asStringValue(raw);
  return value === "debug" || value === "release" ? value : undefined;
};

const asAndroidFormat = (raw: unknown): "apk" | "aab" | undefined => {
  const value = asStringValue(raw);
  return value === "apk" || value === "aab" ? value : undefined;
};

const asAndroidDistribution = (raw: unknown): "play-store" | "direct" | undefined => {
  const value = asStringValue(raw);
  return value === "play-store" || value === "direct" ? value : undefined;
};

const asIosAutoIncrement = (raw: unknown): EasIosAutoIncrement | undefined => {
  if (typeof raw === "boolean") {
    return raw;
  }
  const value = asStringValue(raw);
  return value === "buildNumber" || value === "version" ? value : undefined;
};

const asAndroidAutoIncrement = (raw: unknown): EasAndroidAutoIncrement | undefined => {
  if (typeof raw === "boolean") {
    return raw;
  }
  const value = asStringValue(raw);
  return value === "versionCode" || value === "version" ? value : undefined;
};

const asAutoIncrement = (raw: unknown): EasAutoIncrement | undefined => {
  if (typeof raw === "boolean") {
    return raw;
  }
  const value = asStringValue(raw);
  return value === "buildNumber" || value === "versionCode" || value === "version"
    ? value
    : undefined;
};

const asEasDistribution = (raw: unknown): EasDistribution | undefined => {
  const value = asStringValue(raw);
  return value === "internal" || value === "store" ? value : undefined;
};

const asCredentialsSource = (raw: unknown): EasCredentialsSource | undefined => {
  const value = asStringValue(raw);
  return value === "remote" || value === "local" ? value : undefined;
};

const parseIosProfile = (raw: unknown): EasIosProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const distribution = asIosDistribution(record["distribution"]);
  const buildConfiguration = asStringValue(record["buildConfiguration"]);
  const scheme = asStringValue(record["scheme"]);
  const simulator = asBooleanValue(record["simulator"]);
  const enterpriseProvisioning = asEnterpriseProvisioning(record["enterpriseProvisioning"]);
  const autoIncrement = asIosAutoIncrement(record["autoIncrement"]);
  return {
    ...(distribution === undefined ? {} : { distribution }),
    ...(buildConfiguration === undefined ? {} : { buildConfiguration }),
    ...(scheme === undefined ? {} : { scheme }),
    ...(simulator === undefined ? {} : { simulator }),
    ...(enterpriseProvisioning === undefined ? {} : { enterpriseProvisioning }),
    ...(autoIncrement === undefined ? {} : { autoIncrement }),
  };
};

const parseAndroidProfile = (raw: unknown): EasAndroidProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const buildType = asAndroidBuildType(record["buildType"]);
  const flavor = asStringValue(record["flavor"]);
  const gradleCommand = asStringValue(record["gradleCommand"]);
  const format = asAndroidFormat(record["format"]);
  const distribution = asAndroidDistribution(record["distribution"]);
  const autoIncrement = asAndroidAutoIncrement(record["autoIncrement"]);
  return {
    ...(buildType === undefined ? {} : { buildType }),
    ...(flavor === undefined ? {} : { flavor }),
    ...(gradleCommand === undefined ? {} : { gradleCommand }),
    ...(format === undefined ? {} : { format }),
    ...(distribution === undefined ? {} : { distribution }),
    ...(autoIncrement === undefined ? {} : { autoIncrement }),
  };
};

const parseBuildProfile = (raw: unknown): EasBuildProfile | undefined => {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const extendsName = asStringValue(record["extends"]);
  const developmentClient = asBooleanValue(record["developmentClient"]);
  const distribution = asEasDistribution(record["distribution"]);
  const channel = asStringValue(record["channel"]);
  const environment = asStringValue(record["environment"]);
  const env = asEnv(record["env"]);
  const ios = parseIosProfile(record["ios"]);
  const android = parseAndroidProfile(record["android"]);
  const credentialsSource = asCredentialsSource(record["credentialsSource"]);
  const autoIncrement = asAutoIncrement(record["autoIncrement"]);
  const withoutCredentials = asBooleanValue(record["withoutCredentials"]);
  return {
    ...(extendsName === undefined ? {} : { extends: extendsName }),
    ...(developmentClient === undefined ? {} : { developmentClient }),
    ...(distribution === undefined ? {} : { distribution }),
    ...(channel === undefined ? {} : { channel }),
    ...(environment === undefined ? {} : { environment }),
    ...(env === undefined ? {} : { env }),
    ...(ios === undefined ? {} : { ios }),
    ...(android === undefined ? {} : { android }),
    ...(credentialsSource === undefined ? {} : { credentialsSource }),
    ...(autoIncrement === undefined ? {} : { autoIncrement }),
    ...(withoutCredentials === undefined ? {} : { withoutCredentials }),
  };
};

export const parseEasConfig = (text: string): Effect.Effect<EasConfig, BuildProfileError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause) =>
        new BuildProfileError({
          message: `eas.json is not valid JSON: ${formatCause(cause)}`,
        }),
    });
    const root = asRecord(parsed);
    if (!root) {
      return yield* new BuildProfileError({
        message: "eas.json must be a JSON object at the top level.",
      });
    }
    const buildRecord = asRecord(root["build"]);
    if (!buildRecord) {
      return asRecord(root["cli"]) ? { cli: parseCli(root["cli"]) } : {};
    }
    const profiles: Record<string, EasBuildProfile> = {};
    for (const [name, value] of Object.entries(buildRecord)) {
      const profile = parseBuildProfile(value);
      if (profile) {
        profiles[name] = profile;
      }
    }
    const submitRecord = asRecord(root["submit"]);
    const submit: Record<string, EasSubmitProfile> = {};
    if (submitRecord) {
      for (const [name, value] of Object.entries(submitRecord)) {
        const profile = parseSubmitProfile(value);
        if (profile !== undefined) {
          submit[name] = profile;
        }
      }
    }
    return {
      ...(asRecord(root["cli"]) ? { cli: parseCli(root["cli"]) } : {}),
      build: profiles,
      ...(Object.keys(submit).length === 0 ? {} : { submit }),
    };
  });

const parseCli = (raw: unknown): { readonly version?: string } => {
  const record = asRecord(raw);
  if (!record) {
    return {};
  }
  const version = asStringValue(record["version"]);
  return version === undefined ? {} : { version };
};

const easJsonPath = (projectRoot: string): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return path.join(projectRoot, "eas.json");
  });

export const readEasJson = (
  projectRoot: string,
): Effect.Effect<EasConfig, BuildProfileError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const filePath = yield* easJsonPath(projectRoot);
    const text = yield* fs.readFileString(filePath).pipe(
      Effect.catchAll((cause) =>
        Effect.fail(
          new BuildProfileError({
            message:
              cause._tag === "SystemError" && cause.reason === "NotFound"
                ? `No eas.json found at ${filePath}. Create one with a "build" section.`
                : `Failed to read eas.json: ${cause.message}`,
          }),
        ),
      ),
    );
    return yield* parseEasConfig(text);
  });

const mergeIos = (
  base: EasIosProfile | undefined,
  overlay: EasIosProfile | undefined,
): EasIosProfile | undefined => {
  if (!base) {
    return overlay;
  }
  if (!overlay) {
    return base;
  }
  return { ...base, ...overlay };
};

const mergeAndroid = (
  base: EasAndroidProfile | undefined,
  overlay: EasAndroidProfile | undefined,
): EasAndroidProfile | undefined => {
  if (!base) {
    return overlay;
  }
  if (!overlay) {
    return base;
  }
  return { ...base, ...overlay };
};

const mergeEnv = (
  base: Record<string, string> | undefined,
  overlay: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!base) {
    return overlay;
  }
  if (!overlay) {
    return base;
  }
  return { ...base, ...overlay };
};

const mergeProfile = (base: EasBuildProfile, overlay: EasBuildProfile): EasBuildProfile => {
  const ios = mergeIos(base.ios, overlay.ios);
  const android = mergeAndroid(base.android, overlay.android);
  const env = mergeEnv(base.env, overlay.env);
  const developmentClient = overlay.developmentClient ?? base.developmentClient;
  const distribution = overlay.distribution ?? base.distribution;
  const channel = overlay.channel ?? base.channel;
  const environment = overlay.environment ?? base.environment;
  const credentialsSource = overlay.credentialsSource ?? base.credentialsSource;
  const autoIncrement = overlay.autoIncrement ?? base.autoIncrement;
  const withoutCredentials = overlay.withoutCredentials ?? base.withoutCredentials;
  return {
    ...(overlay.extends === undefined ? {} : { extends: overlay.extends }),
    ...(developmentClient === undefined ? {} : { developmentClient }),
    ...(distribution === undefined ? {} : { distribution }),
    ...(channel === undefined ? {} : { channel }),
    ...(environment === undefined ? {} : { environment }),
    ...(env === undefined ? {} : { env }),
    ...(ios === undefined ? {} : { ios }),
    ...(android === undefined ? {} : { android }),
    ...(credentialsSource === undefined ? {} : { credentialsSource }),
    ...(autoIncrement === undefined ? {} : { autoIncrement }),
    ...(withoutCredentials === undefined ? {} : { withoutCredentials }),
  };
};

const collectExtendsChain = (
  profiles: Record<string, EasBuildProfile>,
  profileName: string,
): Effect.Effect<readonly EasBuildProfile[], BuildProfileError> =>
  Effect.gen(function* () {
    const chain: EasBuildProfile[] = [];
    const visited = new Set<string>();
    let current: string | undefined = profileName;
    let depth = 0;
    while (current !== undefined) {
      if (visited.has(current)) {
        return yield* new BuildProfileError({
          message: `Cycle detected in eas.json build.${profileName} extends chain at "${current}".`,
        });
      }
      visited.add(current);
      const profile: EasBuildProfile | undefined = profiles[current];
      if (!profile) {
        return yield* new BuildProfileError({
          message:
            current === profileName
              ? `Build profile "${profileName}" not found in eas.json.`
              : `Build profile "${profileName}" extends missing profile "${current}".`,
        });
      }
      chain.unshift(profile);
      current = profile.extends;
      depth += 1;
      if (depth > MAX_EXTENDS_DEPTH) {
        return yield* new BuildProfileError({
          message: `Too many "extends" levels (max ${String(MAX_EXTENDS_DEPTH)}) in eas.json build.${profileName}.`,
        });
      }
    }
    return chain;
  });

const stripExtends = (profile: EasBuildProfile): EasBuildProfile => {
  if (profile.extends === undefined) {
    return profile;
  }
  const { extends: _omit, ...rest } = profile;
  return rest;
};

export const resolveEasBuildProfile = (
  config: EasConfig,
  profileName: string,
): Effect.Effect<EasBuildProfile, BuildProfileError> =>
  Effect.gen(function* () {
    const profiles = config.build;
    if (!profiles) {
      return yield* new BuildProfileError({
        message: 'eas.json has no "build" section. Add at least one profile.',
      });
    }
    const chain = yield* collectExtendsChain(profiles, profileName);
    const merged = chain.reduce<EasBuildProfile>(
      (acc, next, index) => (index === 0 ? next : mergeProfile(acc, next)),
      {},
    );
    return stripExtends(merged);
  });
