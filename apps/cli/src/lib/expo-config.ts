import process from "node:process";

import { Effect } from "effect";

import { CliRuntime } from "../services/cli-runtime";
import { BuildProfileError, ProjectNotLinkedError } from "./exit-codes";
import { formatCause } from "./format-error";

import type { AppMeta, Platform, RawRuntimeVersion } from "./build-profile";

export interface ExpoConfig {
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
  readonly extra?: {
    readonly betterUpdate?: {
      readonly projectId?: unknown;
      readonly profiles?: unknown;
    } & Record<string, unknown>;
  } & Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface ConfigFilePaths {
  readonly staticConfigPath: string | null;
  readonly dynamicConfigPath: string | null;
}

interface ExpoConfigModule {
  readonly getConfig: (
    projectRoot: string,
    options?: { readonly skipSDKVersionRequirement?: boolean },
  ) => { readonly exp: ExpoConfig };
  readonly modifyConfigAsync: (
    projectRoot: string,
    modifications: Record<string, unknown>,
    readOptions?: { readonly skipSDKVersionRequirement?: boolean },
  ) => Promise<{
    readonly type: "success" | "warn" | "fail";
    readonly message?: string;
    readonly config: ExpoConfig | null;
  }>;
  readonly getConfigFilePaths: (projectRoot: string) => ConfigFilePaths;
}

const loadExpoConfigModule = (): ExpoConfigModule =>
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- CJS require returns `any`; narrow at the @expo/config boundary
  require("@expo/config") as ExpoConfigModule;

const applyEnvOverlay = (envVars: Record<string, string>): Record<string, string | undefined> => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envVars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  return previous;
};

const restoreEnv = (previous: Record<string, string | undefined>): void => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      // eslint-disable-next-line typescript/no-dynamic-delete -- restoring snapshot of arbitrary process.env keys captured at overlay time
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

/**
 * Resolve the Expo config via `@expo/config`, supporting `app.json`,
 * `app.config.json`, `app.config.js`, and `app.config.ts`.
 *
 * `envVars` are applied as a scoped overlay on `process.env` for the duration
 * of the call so dynamic configs (`app.config.js`/`.ts`) can read them without
 * leaking server-side secrets to child processes.
 */
export const readExpoConfig = (
  projectRoot: string,
  envVars: Record<string, string> = {},
): Effect.Effect<ExpoConfig, ProjectNotLinkedError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => applyEnvOverlay(envVars)),
    () =>
      Effect.try({
        try: () =>
          loadExpoConfigModule().getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp,
        catch: (cause) =>
          new ProjectNotLinkedError({
            message: `Failed to load Expo config from ${projectRoot}: ${formatCause(cause)}`,
          }),
      }),
    (previous) =>
      Effect.sync(() => {
        restoreEnv(previous);
      }),
  );

export const getConfigFilePaths = (
  projectRoot: string,
): Effect.Effect<ConfigFilePaths, ProjectNotLinkedError> =>
  Effect.try({
    try: () => loadExpoConfigModule().getConfigFilePaths(projectRoot),
    catch: (cause) =>
      new ProjectNotLinkedError({
        message: `Failed to inspect Expo config paths in ${projectRoot}: ${formatCause(cause)}`,
      }),
  });

export const extractProjectId = (
  config: ExpoConfig,
): Effect.Effect<string, ProjectNotLinkedError> =>
  Effect.gen(function* () {
    const projectId = config.extra?.betterUpdate?.projectId;
    if (typeof projectId !== "string") {
      return yield* new ProjectNotLinkedError({
        message:
          "Project not linked. Run `better-update link` to connect this project, or set extra.betterUpdate.projectId in your Expo config.",
      });
    }
    return projectId;
  });

export const extractSlug = (config: ExpoConfig): Effect.Effect<string, ProjectNotLinkedError> =>
  Effect.gen(function* () {
    if (typeof config.slug !== "string") {
      return yield* new ProjectNotLinkedError({
        message: "Missing slug in your Expo config. Required to identify the project.",
      });
    }
    return config.slug;
  });

/** Convenience reader for command code: resolves projectRoot from CliRuntime. */
export const readProjectId: Effect.Effect<string, ProjectNotLinkedError, CliRuntime> = Effect.gen(
  function* () {
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;
    const config = yield* readExpoConfig(projectRoot);
    return yield* extractProjectId(config);
  },
);

export interface WriteProjectIdResult {
  readonly type: "success" | "warn";
  readonly configPath: string | null;
  readonly message?: string;
}

const buildManualPasteHint = (id: string, message?: string): string => {
  const reason = message ? ` (${message})` : "";
  return [
    `Cannot write projectId to a dynamic Expo config${reason}.`,
    "Add this to your config manually:",
    "",
    `  extra: { betterUpdate: { projectId: "${id}" } }`,
  ].join("\n");
};

export const writeProjectId = (
  projectRoot: string,
  id: string,
): Effect.Effect<WriteProjectIdResult, ProjectNotLinkedError> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: async () =>
        loadExpoConfigModule().modifyConfigAsync(
          projectRoot,
          { extra: { betterUpdate: { projectId: id } } },
          { skipSDKVersionRequirement: true },
        ),
      catch: (cause) =>
        new ProjectNotLinkedError({
          message: `Failed to write projectId to Expo config: ${formatCause(cause)}`,
        }),
    });

    // `modifyConfigAsync` returns 'warn' with config: null when only a dynamic
    // Config exists (it can't write to .js/.ts) and 'fail' for hard errors.
    // Both indicate the projectId did NOT get persisted — surface a manual-paste hint.
    if (result.type === "fail" || (result.type === "warn" && result.config === null)) {
      return yield* new ProjectNotLinkedError({
        message: buildManualPasteHint(id, result.message),
      });
    }

    const paths = yield* getConfigFilePaths(projectRoot);
    return {
      type: result.type,
      configPath: paths.staticConfigPath,
      ...(result.message === undefined ? {} : { message: result.message }),
    } satisfies WriteProjectIdResult;
  });

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
 */
export const readAppMeta = (
  config: ExpoConfig,
  platform: Platform,
): Effect.Effect<AppMeta, BuildProfileError> =>
  Effect.gen(function* () {
    if (platform === "ios" && !config.ios) {
      return yield* new BuildProfileError({
        message:
          "Missing ios section in your Expo config. Required for iOS builds (bundleIdentifier).",
      });
    }
    if (platform === "android" && !config.android) {
      return yield* new BuildProfileError({
        message:
          "Missing android section in your Expo config. Required for Android builds (package).",
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
