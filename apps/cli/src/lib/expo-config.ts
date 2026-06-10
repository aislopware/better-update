import nodePath from "node:path";
import process from "node:process";

import { CODE_SIGNING_ALG } from "@better-update/expo-codesign";
import { asRecord, compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";

import { BETTER_UPDATE_PROJECT_ID_ENV } from "./eas-json";
import { BuildProfileError, ProjectNotLinkedError, UpdatePublishError } from "./exit-codes";
import { formatCause } from "./format-error";

import type { AppMeta, Platform, RawRuntimeVersion } from "./build-profile";

export interface ExpoUpdatesConfig {
  readonly url?: string;
  readonly enabled?: boolean;
  readonly checkAutomatically?: string;
  readonly fallbackToCacheTimeout?: number;
  readonly useEmbeddedUpdate?: boolean;
  readonly requestHeaders?: Record<string, string>;
  readonly enableBsdiffPatchSupport?: boolean;
  // SDK-56 anti-bricking toggle. Default false (off = anti-bricking ACTIVE).
  // When true, the native Updates plugin disables the on-device guards that
  // prevent a bad update from bricking the app — NOT recommended for production.
  readonly disableAntiBrickingMeasures?: boolean;
  // Standard expo-updates code-signing fields (app.json `updates`): a relative
  // path to the PEM code-signing certificate + its metadata (keyid/alg).
  readonly codeSigningCertificate?: string;
  readonly codeSigningMetadata?: {
    readonly keyid?: string;
    readonly alg?: string;
  };
  readonly [key: string]: unknown;
}

export interface ExpoConfig {
  readonly name?: string;
  readonly slug?: string;
  readonly version?: string;
  readonly sdkVersion?: string;
  readonly runtimeVersion?: string | { readonly policy: string };
  readonly updates?: ExpoUpdatesConfig;
  readonly ios?: {
    readonly bundleIdentifier?: string;
    readonly buildNumber?: string;
    readonly version?: string;
    readonly runtimeVersion?: string | { readonly policy: string };
  };
  readonly android?: {
    readonly package?: string;
    readonly versionCode?: number;
    readonly version?: string;
    readonly runtimeVersion?: string | { readonly policy: string };
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

/**
 * Whether `@expo/config` is installed/resolvable. A non-Expo project (KMP,
 * Flutter, native) never installs Expo, so callers must gate any `@expo/config`
 * access behind this to avoid throwing at module resolution. Used by the
 * build-system-neutral resolver in `project-link.ts`.
 */
export const isExpoConfigInstalled = (): boolean => {
  try {
    loadExpoConfigModule();
    return true;
  } catch {
    return false;
  }
};

/**
 * Build-system-neutral "project not linked" guidance, listing every supported
 * project-id source (env override, eas.json, Expo config) so the
 * message is correct for Expo and non-Expo projects alike.
 */
export const PROJECT_NOT_LINKED_MESSAGE =
  "Project not linked. Run `better-update init` to link this project, set the " +
  `${BETTER_UPDATE_PROJECT_ID_ENV} environment variable, add a top-level "projectId" to eas.json, ` +
  "or set extra.betterUpdate.projectId in your Expo config.";

// `@expo/config` resolves dynamic configs via Node's `require`, which caches the
// Evaluated module by absolute path. For static-form `module.exports = {...}`
// Files, top-level `process.env` reads are captured at first load and frozen,
// So a subsequent `readExpoConfig` call with a different env overlay would
// Silently return the stale cached object. Evicting the cached entry forces
// Re-evaluation on every call so env overlays always take effect.
const clearDynamicConfigCache = (projectRoot: string): void => {
  const { dynamicConfigPath } = loadExpoConfigModule().getConfigFilePaths(projectRoot);
  if (dynamicConfigPath) {
    // eslint-disable-next-line typescript/no-dynamic-delete -- evict @expo/config-cached module so each readExpoConfig sees fresh process.env
    delete require.cache[dynamicConfigPath];
  }
};

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
    Effect.sync(() => {
      clearDynamicConfigCache(projectRoot);
      return applyEnvOverlay(envVars);
    }),
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
      return yield* new ProjectNotLinkedError({ message: PROJECT_NOT_LINKED_MESSAGE });
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

export interface CodeSigningConfig {
  /** Relative path to the PEM code-signing certificate (from `app.json`). */
  readonly certificatePath: string;
  readonly keyid: string;
  readonly alg: string;
}

/**
 * Read the expo-updates code-signing config from the resolved Expo config.
 *
 * `updates.codeSigningCertificate` is a relative path to the PEM certificate;
 * `updates.codeSigningMetadata.keyid` defaults to `main` (Expo CLI writes `main`;
 * the device default is `root`) and `alg` defaults to {@link CODE_SIGNING_ALG}.
 * Any non-`rsa-v1_5-sha256` alg is REJECTED here — ECDSA is gated off the wire.
 *
 * Returns `undefined` when no `codeSigningCertificate` is configured (the project
 * is not set up for code signing).
 */
export const extractCodeSigningConfig = (
  config: ExpoConfig,
): Effect.Effect<CodeSigningConfig | undefined, UpdatePublishError> =>
  Effect.gen(function* () {
    const certificatePath = config.updates?.codeSigningCertificate;
    if (typeof certificatePath !== "string" || certificatePath.length === 0) {
      return undefined;
    }
    const metadata = config.updates?.codeSigningMetadata;
    const keyid = typeof metadata?.keyid === "string" ? metadata.keyid : "main";
    const alg = typeof metadata?.alg === "string" ? metadata.alg : CODE_SIGNING_ALG;
    if (alg !== CODE_SIGNING_ALG) {
      return yield* new UpdatePublishError({
        message: `Unsupported code-signing alg "${alg}" in updates.codeSigningMetadata; only ${CODE_SIGNING_ALG} is supported.`,
      });
    }
    return { certificatePath, keyid, alg };
  });

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
      ...compact({ message: result.message }),
    } satisfies WriteProjectIdResult;
  });

export interface WriteExpoConfigPatchResult {
  readonly type: "success" | "warn";
  readonly configPath: string | null;
  readonly message?: string;
}

export const writeExpoConfigPatch = (
  projectRoot: string,
  patch: Record<string, unknown>,
): Effect.Effect<WriteExpoConfigPatchResult, ProjectNotLinkedError> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: async () =>
        loadExpoConfigModule().modifyConfigAsync(projectRoot, patch, {
          skipSDKVersionRequirement: true,
        }),
      catch: (cause) =>
        new ProjectNotLinkedError({
          message: `Failed to write Expo config: ${formatCause(cause)}`,
        }),
    });

    if (result.type === "fail") {
      return yield* new ProjectNotLinkedError({
        message: result.message ?? "Failed to write Expo config.",
      });
    }

    const paths = yield* getConfigFilePaths(projectRoot);
    return {
      type: result.type,
      configPath: result.config === null ? null : paths.staticConfigPath,
      ...compact({ message: result.message }),
    } satisfies WriteExpoConfigPatchResult;
  });

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const extractBuildNumber = (config: ExpoConfig, platform: Platform): string | undefined => {
  if (platform === "ios") {
    return config.ios?.buildNumber;
  }
  if (config.android?.versionCode === undefined) {
    return undefined;
  }
  return String(config.android.versionCode);
};

/**
 * Resolve the effective app version for a platform, mirroring
 * `@expo/config-plugins` `getVersion` (a per-platform `ios.version` /
 * `android.version` falls back to the top-level `expo.version`). Returns
 * `undefined` when none is set so the runtimeVersion resolver can apply EAS's
 * `1.0.0` default.
 */
export const extractAppVersion = (config: ExpoConfig, platform: Platform): string | undefined =>
  config[platform]?.version ?? config.version;

/**
 * Reduce an installed `expo` package version (e.g. `52.0.11`) to the SDK version
 * EAS derives for the `sdkVersion` runtimeVersion policy. Mirrors
 * `@expo/config`'s `getExpoSDKVersionFromPackage`, which takes the major segment
 * and appends `.0.0` — so `52.0.11` becomes `52.0.0`, not the raw `52.0.11`.
 * The device build resolved by Expo tooling reports `exposdk:52.0.0`, so the
 * RTV the CLI publishes must match.
 *
 * Returns `undefined` for a missing/empty major segment so callers can surface a
 * precise error instead of producing `exposdk:.0.0`.
 */
export const expoSdkVersionFromPackageVersion = (packageVersion: string): string | undefined => {
  const major = packageVersion.split(".").shift();
  if (major === undefined || major.length === 0) {
    return undefined;
  }
  return `${major}.0.0`;
};

/**
 * Resolve the path to the installed `expo` package's `package.json` using Node
 * module resolution rooted at `projectRoot`, so a hoisted monorepo install
 * (where `expo` lives at the workspace root, not `<projectRoot>/node_modules`)
 * resolves correctly — mirroring EAS's `resolveFrom(projectRoot, 'expo/package.json')`.
 *
 * Falls back to the conventional `<projectRoot>/node_modules/expo/package.json`
 * join when `require.resolve` throws (e.g. no resolver paths in the host), and
 * returns `undefined` only if neither yields a path. The downstream FileSystem
 * read is the I/O boundary, so a returned-but-nonexistent path still degrades to
 * the "expo not installed" error rather than crashing.
 */
const resolveExpoPackageJsonPath = (projectRoot: string): string | undefined => {
  try {
    return require.resolve("expo/package.json", { paths: [projectRoot] });
  } catch {
    return nodePath.join(projectRoot, "node_modules", "expo", "package.json");
  }
};

/**
 * Resolve the installed Expo SDK version by locating the `expo` package's
 * `package.json` via Node resolution (so hoisted/monorepo installs work) and
 * reducing its `version` to `${major}.0.0`. Mirrors EAS, which derives
 * `sdkVersion` from the installed `expo` package when the resolved Expo config
 * omits it (the CLI loads the config with `skipSDKVersionRequirement: true`, so
 * `config.sdkVersion` is often undefined).
 *
 * Returns `undefined` on a missing file, unreadable file, unparseable JSON, a
 * non-string `version`, or an unusable major segment so callers can produce a
 * precise error rather than crashing on I/O.
 */
export const resolveInstalledExpoSdkVersion = (
  projectRoot: string,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const packageJsonPath = resolveExpoPackageJsonPath(projectRoot);
    if (packageJsonPath === undefined) {
      return undefined;
    }
    const raw = yield* fs.readFileString(packageJsonPath).pipe(Effect.option);
    if (Option.isNone(raw)) {
      return undefined;
    }
    const parsed = yield* Effect.try((): unknown => JSON.parse(raw.value)).pipe(Effect.option);
    if (Option.isNone(parsed)) {
      return undefined;
    }
    const record = asRecord(parsed.value);
    const packageVersion = asString(record?.["version"]);
    if (packageVersion === undefined) {
      return undefined;
    }
    return expoSdkVersionFromPackageVersion(packageVersion);
  });

const normalizeRawRuntimeVersion = (
  raw: string | { readonly policy: string } | undefined,
): RawRuntimeVersion | undefined => {
  if (typeof raw === "string") {
    return raw;
  }
  // typeof null === "object" — guard before reading `policy` so configs that
  // explicitly clear runtimeVersion (e.g. `runtimeVersion: null` from a dynamic
  // config) fall through to undefined instead of crashing resolveRuntimeVersion.
  // eslint-disable-next-line typescript/no-unnecessary-condition -- runtime guard against `runtimeVersion: null` even though the static type excludes null
  if (typeof raw === "object" && raw !== null && typeof raw.policy === "string") {
    return { policy: raw.policy };
  }
  return undefined;
};

/**
 * Resolve the effective `runtimeVersion` for a platform, mirroring EAS/expo-updates
 * (`resolveRuntimeVersionAsync.ts`, `@expo/config-plugins` Updates.ts): a
 * per-platform `ios.runtimeVersion` / `android.runtimeVersion` takes precedence
 * over the top-level `config.runtimeVersion`.
 */
export const extractRawRuntimeVersion = (
  config: ExpoConfig,
  platform: Platform,
): RawRuntimeVersion | undefined =>
  normalizeRawRuntimeVersion(config[platform]?.runtimeVersion) ??
  normalizeRawRuntimeVersion(config.runtimeVersion);

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
      appVersion: extractAppVersion(config, platform),
      buildNumber: extractBuildNumber(config, platform),
      rawRuntimeVersion: extractRawRuntimeVersion(config, platform),
    };
  });
