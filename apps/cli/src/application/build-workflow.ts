import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect, Either } from "effect";

import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { runStep } from "../commands/build/run-step";
import { applyAutoIncrement } from "../lib/auto-increment";
import { runBuildHook } from "../lib/build-hooks";
import { readBuildProfile } from "../lib/build-profile";
import { clearBuildCaches } from "../lib/clear-cache";
import { asProjectType, detectProjectType } from "../lib/detect-project-type";
import { warnIfDevClientMissing } from "../lib/dev-client-check";
import { listBuildProfileNames, readEasProjectType } from "../lib/eas-json";
import { pullEnvVars } from "../lib/env-exporter";
import { BuildProfileError } from "../lib/exit-codes";
import { readAppMeta, readExpoConfig } from "../lib/expo-config";
import { runFingerprintForPlatform } from "../lib/fingerprint";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman, printKeyValue } from "../lib/output";
import { detectPlatform, detectPlatformGeneric } from "../lib/platform-detect";
import { readProjectId } from "../lib/project-link";
import { prepareStagingProject } from "../lib/project-staging";
import { promptSelect } from "../lib/prompts";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { printWarn } from "../lib/warning-style";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { runAutoSubmit } from "./build-auto-submit";
import { runPlatformBuild } from "./platform-build";
import { resolveAppMeta } from "./resolve-app-meta";
import { resolveUpdateChannel } from "./resolve-update-channel";

import type { Platform } from "../lib/build-profile";
import type { PackageManager } from "../lib/project-staging";
import type { AppMeta, BuildProfile } from "./platform-build";

export interface RunBuildWorkflowOptions {
  readonly platform: Platform | undefined;
  readonly profileName: string;
  readonly message: string | undefined;
  readonly noUpload: boolean;
  readonly output?: string;
  readonly rawOutput?: boolean;
  readonly clearCache?: boolean;
  readonly freezeCredentials?: boolean;
  readonly allowDirty?: boolean;
  readonly autoSubmit?: boolean;
  readonly autoSubmitProfile?: string;
  readonly whatToTest?: string;
}

const dirExists = (root: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(path.join(root, name)).pipe(Effect.orElseSucceed(() => false));
  });

interface BuildMeta {
  readonly appMeta: AppMeta;
  readonly runtimeVersion: string | undefined;
}

/**
 * Expo metadata path: read app.json (with the env overlay so dynamic configs
 * resolve), apply autoIncrement to the user's tree, re-read, then derive the OTA
 * runtimeVersion. Mirrors the original managed flow.
 */
const resolveExpoBuildMeta = (params: {
  readonly userCwd: string;
  readonly platform: Platform;
  readonly profile: BuildProfile;
  readonly envVars: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const { userCwd, platform, profile, envVars } = params;
    const expoConfig = yield* readExpoConfig(userCwd, envVars);
    yield* applyAutoIncrement({
      projectRoot: userCwd,
      platform,
      config: expoConfig,
      ...(platform === "ios" && profile.ios?.autoIncrement !== undefined
        ? { iosMode: profile.ios.autoIncrement }
        : {}),
      ...(platform === "android" && profile.android?.autoIncrement !== undefined
        ? { androidMode: profile.android.autoIncrement }
        : {}),
    });
    const bumpedConfig = yield* readExpoConfig(userCwd, envVars);
    const expoAppMeta = yield* readAppMeta(bumpedConfig, platform);
    const appMeta = yield* resolveAppMeta({
      projectType: "expo",
      platform,
      projectRoot: userCwd,
      profile,
      expoAppMeta,
    });
    const runtimeVersion = yield* resolveRuntimeVersion({
      raw: appMeta.rawRuntimeVersion,
      appVersion: appMeta.appVersion,
      projectRoot: userCwd,
      platform,
      buildNumber: appMeta.buildNumber,
      sdkVersion: bumpedConfig.sdkVersion,
    });
    return { appMeta, runtimeVersion };
  });

/**
 * EAS-parity lifecycle hooks after the native build. Success-path hook
 * failures fail the build; failure-path hooks are best-effort so they never
 * mask the original build error.
 */
const runBuildLifecycleHooks = (params: {
  readonly succeeded: boolean;
  readonly projectRoot: string;
  readonly packageManager: PackageManager;
  readonly env: Readonly<Record<string, string>>;
}) =>
  Effect.gen(function* () {
    const { env, packageManager, projectRoot } = params;
    const hook = (name: "eas-build-on-success" | "eas-build-on-error" | "eas-build-on-complete") =>
      runBuildHook({ name, projectRoot, packageManager, env });
    if (params.succeeded) {
      yield* hook("eas-build-on-success");
      yield* hook("eas-build-on-complete");
      return;
    }
    yield* hook("eas-build-on-error").pipe(
      Effect.catchAll((error) => printWarn(`eas-build-on-error hook: ${formatCause(error)}`)),
    );
    yield* hook("eas-build-on-complete").pipe(
      Effect.catchAll((error) => printWarn(`eas-build-on-complete hook: ${formatCause(error)}`)),
    );
  });

const printBuildHeader = (params: {
  readonly platform: Platform;
  readonly profileName: string;
  readonly runtimeVersion: string | undefined;
  readonly updateChannel: string | undefined;
}) => {
  const details = [
    ...(params.runtimeVersion === undefined ? [] : [`runtimeVersion=${params.runtimeVersion}`]),
    ...(params.updateChannel === undefined ? [] : [`channel=${params.updateChannel}`]),
  ];
  return printHuman(
    `Building ${params.platform} artifact for profile "${params.profileName}"${
      details.length === 0 ? "" : ` (${details.join(", ")})`
    }`,
  );
};

/**
 * Warning-only `expo-doctor` pass before the native build (mirrors EAS's
 * RUN_EXPO_DOCTOR phase): findings and timeouts are reported but never fail
 * the build.
 */
const runExpoDoctor = (params: {
  readonly projectRoot: string;
  readonly env: Readonly<Record<string, string>>;
}) =>
  runStep(
    { command: "bunx", args: ["expo-doctor"], cwd: params.projectRoot, env: params.env },
    "expo-doctor",
  ).pipe(
    Effect.timeout("30 seconds"),
    Effect.catchAll(() =>
      printWarn("expo-doctor reported issues or timed out — continuing (warning only)."),
    ),
  );

const resolveProfileName = (projectRoot: string, requested: string) =>
  Effect.gen(function* () {
    const available = yield* listBuildProfileNames(projectRoot);
    if (available.includes(requested)) {
      return requested;
    }
    const mode = yield* InteractiveMode;
    if (!mode.allow || available.length === 0) {
      // Let readBuildProfile fail with its existing "not found" message,
      // or with the missing-eas.json / empty-build-section message.
      return requested;
    }
    yield* printHuman(`Build profile "${requested}" not found in eas.json.`);
    return yield* promptSelect<string>(
      "Pick a build profile:",
      available.map((name) => ({ value: name, label: name })),
    );
  });

export const runBuildWorkflow = (options: RunBuildWorkflowOptions) =>
  Effect.scoped(
    // eslint-disable-next-line eslint/max-statements -- build orchestration is inherently sequential (read config → detect platform → resolve profile → pull env → build → upload → optional submit); splitting further fragments the pipeline
    Effect.gen(function* () {
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      // The user's working directory. Reads/writes that must persist for the
      // user (autoIncrement bumps, git context, --output resolution, cache
      // clearing) target this path. Native build steps run in a copy.
      const userCwd = yield* runtime.cwd;

      yield* ensureRepoClean({
        projectRoot: userCwd,
        allowDirty: options.allowDirty ?? false,
        label: "build",
      });

      // Resolve the build-system family (eas.json `projectType` wins).
      const projectType = yield* detectProjectType({
        projectRoot: userCwd,
        override: asProjectType(yield* readEasProjectType(userCwd)),
      });
      const isExpo = projectType === "expo";

      // projectId via the build-system-neutral resolver
      // (env override > eas.json > Expo config).
      const projectId = yield* readProjectId;

      // Resolve profile name + profile (static, env- and platform-independent).
      const profileName = yield* resolveProfileName(userCwd, options.profileName);
      const profile = yield* readBuildProfile(userCwd, profileName);

      if (profile.developmentClient === true) {
        yield* warnIfDevClientMissing(userCwd);
      }

      // Pull env vars for the profile's environment scope, then overlay the
      // profile.env block on top (profile keys win over remote on collision).
      // This happens before any config evaluation below so dynamic Expo configs
      // never run against a bare process.env.
      const remoteEnvVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });
      const envVars = { ...remoteEnvVars, ...profile.env };

      // Detect the platform: Expo infers from app.json (loaded lazily — an
      // explicit --platform skips the config read); non-Expo intersects the
      // profile's declared sections with the native dirs present on disk.
      const platform = isExpo
        ? yield* detectPlatform(options.platform, readExpoConfig(userCwd, envVars))
        : yield* detectPlatformGeneric(options.platform, {
            profile,
            hasAndroidDir: yield* dirExists(userCwd, "android"),
            hasIosDir: yield* dirExists(userCwd, "ios"),
          });

      const updateChannel = yield* resolveUpdateChannel({
        userCwd,
        platform,
        profile,
        projectType,
      });

      // Best-effort git context — used for build metadata at upload time and
      // exposed to subprocesses (EAS_BUILD_GIT_COMMIT_HASH parity).
      const rawGitContext = yield* readGitContext(userCwd);

      // Build-identity env (mirrors EAS_BUILD*): every subprocess from here on
      // (dynamic app.config evaluation, install, hooks, prebuild, native build)
      // can detect the build and its parameters.
      const envWithBuildId = {
        ...envVars,
        BETTER_UPDATE_BUILD: "1",
        BETTER_UPDATE_BUILD_RUNNER: "cli",
        BETTER_UPDATE_BUILD_PLATFORM: platform,
        BETTER_UPDATE_BUILD_PROFILE: profile.name,
        BETTER_UPDATE_BUILD_PROJECT_ID: projectId,
        ...compact({ BETTER_UPDATE_BUILD_GIT_COMMIT_HASH: rawGitContext.commit }),
      };

      // Resolve app metadata + OTA runtimeVersion. Expo reads app.json (with the
      // env overlay), applies autoIncrement to the user's tree, and derives a
      // runtimeVersion. Non-Expo reads native files / profile overrides and has
      // no runtimeVersion (no eas-updates).
      const { appMeta, runtimeVersion }: BuildMeta = isExpo
        ? yield* resolveExpoBuildMeta({ userCwd, platform, profile, envVars: envWithBuildId })
        : {
            appMeta: yield* resolveAppMeta({
              projectType,
              platform,
              projectRoot: userCwd,
              profile,
            }),
            runtimeVersion: undefined,
          };

      // Platform version env (EAS_BUILD_IOS_* / EAS_BUILD_ANDROID_* parity).
      const buildEnvVars = {
        ...envWithBuildId,
        ...compact(
          platform === "ios"
            ? {
                BETTER_UPDATE_BUILD_IOS_APP_VERSION: appMeta.appVersion,
                BETTER_UPDATE_BUILD_IOS_BUILD_NUMBER: appMeta.buildNumber,
              }
            : {
                BETTER_UPDATE_BUILD_ANDROID_VERSION_NAME: appMeta.appVersion,
                BETTER_UPDATE_BUILD_ANDROID_VERSION_CODE: appMeta.buildNumber,
              },
        ),
      };

      if (options.clearCache) {
        yield* clearBuildCaches(userCwd);
      }

      const tempDir = yield* acquireBuildTempDir;

      // Mirror cwd (or its workspace root for monorepos) into a staging dir
      // and reinstall deps there. From here on, every native build command
      // runs against `staging.projectRoot`; the user's tree is untouched.
      const staging = yield* prepareStagingProject({
        userCwd,
        tempDir,
        envVars: buildEnvVars,
        projectType,
      });
      const buildEnv = { ...buildEnvVars, BETTER_UPDATE_BUILD_WORKINGDIR: staging.stagingRoot };

      if (isExpo) {
        yield* runExpoDoctor({
          projectRoot: staging.projectRoot,
          env: yield* runtime.commandEnvironment(buildEnv),
        });
      }

      yield* printBuildHeader({
        platform,
        profileName: profile.name,
        runtimeVersion,
        updateChannel,
      });

      const buildOutcome = yield* Effect.either(
        runPlatformBuild({
          api,
          platform,
          profile,
          projectType,
          appMeta,
          envVars: buildEnv,
          projectId,
          projectRoot: staging.projectRoot,
          tempDir,
          packageManager: staging.packageManager,
          updateChannel,
          freezeCredentials: options.freezeCredentials ?? false,
          rawOutput: options.rawOutput,
        }),
      );

      const lifecycleStatus = Either.isRight(buildOutcome) ? "finished" : "errored";
      yield* runBuildLifecycleHooks({
        succeeded: Either.isRight(buildOutcome),
        projectRoot: staging.projectRoot,
        packageManager: staging.packageManager,
        env: yield* runtime.commandEnvironment({
          ...buildEnv,
          BETTER_UPDATE_BUILD_STATUS: lifecycleStatus,
          EAS_BUILD_STATUS: lifecycleStatus,
        }),
      });
      if (Either.isLeft(buildOutcome)) {
        return yield* Effect.fail(buildOutcome.left);
      }
      const { build, target, bundleId } = buildOutcome.right;

      yield* printHuman(`Artifact produced: ${build.artifactPath}`);

      let exportedArtifactPath: string | undefined = undefined;
      if (options.output !== undefined) {
        const fs = yield* FileSystem.FileSystem;
        const outputPath = path.resolve(userCwd, options.output);
        const outputDir = path.dirname(outputPath);
        yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(
          Effect.mapError(
            (cause) =>
              new BuildProfileError({
                message: `Failed to create output directory: ${formatCause(cause)}`,
              }),
          ),
        );
        yield* fs.copyFile(build.artifactPath, outputPath).pipe(
          Effect.mapError(
            (cause) =>
              new BuildProfileError({
                message: `Failed to copy artifact to ${outputPath}: ${formatCause(cause)}`,
              }),
          ),
        );
        exportedArtifactPath = outputPath;
        yield* printHuman(`Copied artifact to ${outputPath}`);
      }

      if (options.noUpload) {
        yield* printKeyValue([
          ["Artifact", build.artifactPath],
          ...(exportedArtifactPath ? [["Exported to", exportedArtifactPath] as const] : []),
          ["SHA-256", build.sha256],
          ["Bytes", String(build.byteSize)],
          ["Upload", "skipped (--no-upload)"],
        ]);
        return;
      }

      const gitContext = compact({
        ref: rawGitContext.ref,
        commit: rawGitContext.commit,
        dirty: rawGitContext.dirty,
      });

      // Per-platform fingerprint (matching EAS) so the recorded build hash lines
      // up with the per-platform `fingerprint`-policy RTV and with updates
      // fingerprinted the same way. Expo-only — non-Expo builds have no OTA, so
      // there is nothing to fingerprint.
      const fingerprintHash = isExpo
        ? yield* runFingerprintForPlatform(userCwd, platform).pipe(
            Effect.map((entry) => entry.hash),
            Effect.orElseSucceed(() => undefined),
          )
        : undefined;

      const result = yield* reserveAndUpload(api, {
        target,
        projectId,
        profileName: profile.name,
        bundleId,
        gitContext,
        artifactPath: build.artifactPath,
        sha256: build.sha256,
        byteSize: build.byteSize,
        ...compact({
          runtimeVersion,
          appVersion: appMeta.appVersion,
          buildNumber: appMeta.buildNumber,
          message: options.message,
          fingerprintHash,
        }),
      });

      yield* printHuman("");
      yield* printKeyValue([
        ["Build ID", result.id],
        ["Status", result.status],
        ["Platform", platform],
        ["Profile", profile.name],
        ...(runtimeVersion === undefined ? [] : [["Runtime version", runtimeVersion] as const]),
        ["Artifact", build.artifactPath],
        ["SHA-256", build.sha256],
        ["Bytes", String(build.byteSize)],
      ]);

      if (options.autoSubmit === true) {
        yield* runAutoSubmit({
          api,
          buildId: result.id,
          projectId,
          platform,
          profileName: options.autoSubmitProfile ?? profile.name,
          ...compact({ whatToTest: options.whatToTest }),
        });
      }
    }),
  );
