import { asRecord, compact } from "@better-update/type-guards";
import { FileSystem, Path } from "@effect/platform";
import { Effect } from "effect";

import {
  asBooleanValue,
  asStringValue,
  resolveExtendsChain,
  shallowMerge,
  stripExtends,
} from "./eas-profile-extends";
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
  return compact({
    distribution,
    buildConfiguration,
    scheme,
    simulator,
    enterpriseProvisioning,
    autoIncrement,
  });
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
  return compact({
    buildType,
    flavor,
    gradleCommand,
    format,
    distribution,
    autoIncrement,
  });
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
  return compact({
    extends: extendsName,
    developmentClient,
    distribution,
    channel,
    environment,
    env,
    ios,
    android,
    credentialsSource,
    autoIncrement,
    withoutCredentials,
  });
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
  return compact({ version });
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

const mergeProfile = (base: EasBuildProfile, overlay: EasBuildProfile): EasBuildProfile => {
  const ios = shallowMerge(base.ios, overlay.ios);
  const android = shallowMerge(base.android, overlay.android);
  const env = shallowMerge(base.env, overlay.env);
  const developmentClient = overlay.developmentClient ?? base.developmentClient;
  const distribution = overlay.distribution ?? base.distribution;
  const channel = overlay.channel ?? base.channel;
  const environment = overlay.environment ?? base.environment;
  const credentialsSource = overlay.credentialsSource ?? base.credentialsSource;
  const autoIncrement = overlay.autoIncrement ?? base.autoIncrement;
  const withoutCredentials = overlay.withoutCredentials ?? base.withoutCredentials;
  return compact({
    extends: overlay.extends,
    developmentClient,
    distribution,
    channel,
    environment,
    env,
    ios,
    android,
    credentialsSource,
    autoIncrement,
    withoutCredentials,
  });
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
    const chain = yield* resolveExtendsChain({
      profiles,
      profileName,
      label: "build",
      maxDepth: MAX_EXTENDS_DEPTH,
      makeError: (message) => new BuildProfileError({ message }),
    });
    const merged = chain.reduce<EasBuildProfile>(
      (acc, next, index) => (index === 0 ? next : mergeProfile(acc, next)),
      {},
    );
    return stripExtends(merged);
  });
