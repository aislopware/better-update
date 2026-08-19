import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem, Effect, Result } from "effect";

import type { Semaphore } from "effect";

import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { runStep } from "../commands/build/run-step";
import { uploadDebugArtifacts } from "../commands/build/upload-debug-artifacts";
import { runBuildHook } from "../lib/build-hooks";
import { readBuildProfile } from "../lib/build-profile";
import { clearBuildCaches } from "../lib/clear-cache";
import { asProjectType, detectProjectType } from "../lib/detect-project-type";
import { warnIfDevClientMissing } from "../lib/dev-client-check";
import { readEasProjectType } from "../lib/eas-json";
import { pullEnvVars } from "../lib/env-exporter";
import { readExpoConfig } from "../lib/expo-config";
import { runFingerprintForPlatform } from "../lib/fingerprint";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { withOptionalPermit } from "../lib/optional-mutex";
import { wantsOtaExpoConfig } from "../lib/ota-expo-config";
import { printHuman, printKeyValue } from "../lib/output";
import { detectPlatform, detectPlatformGeneric } from "../lib/platform-detect";
import { readProjectId } from "../lib/project-link";
import { prepareStagingProject } from "../lib/project-staging";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveProfileName } from "../lib/resolve-profile-name";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { printWarn } from "../lib/warning-style";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { exportArtifact } from "./build-artifact-output";
import { runAutoSubmit } from "./build-auto-submit";
import { runPlatformBuild } from "./platform-build";
import { resolveExpoBuildMeta } from "./resolve-expo-build-meta";
import { resolveNativeBuildMeta } from "./resolve-native-build-meta";
import { resolveUpdateChannel } from "./resolve-update-channel";

import type { Platform } from "../lib/build-profile";
import type { PackageManager } from "../lib/project-staging";
import type { BuildMeta } from "./resolve-expo-build-meta";

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
  /**
   * Set by the `--platform all` orchestrator: serializes the sections two
   * parallel platform-build fibers must not enter together (app.json
   * autoIncrement writes, interactive credential setup, auto-submit).
   */
  readonly mutex?: Semaphore.Semaphore;
}

const dirExists = (root: string, name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(path.join(root, name)).pipe(Effect.orElseSucceed(() => false));
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
      Effect.catch((error) => printWarn(`eas-build-on-error hook: ${formatCause(error)}`)),
    );
    yield* hook("eas-build-on-complete").pipe(
      Effect.catch((error) => printWarn(`eas-build-on-complete hook: ${formatCause(error)}`)),
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
    Effect.catch(() =>
      printWarn("expo-doctor reported issues or timed out — continuing (warning only)."),
    ),
  );

/**
 * Per-platform fingerprint (matching EAS) so the recorded build hash lines up
 * with the per-platform `fingerprint`-policy runtime version and with updates
 * fingerprinted the same way. Best-effort: a failure records no hash.
 *
 * Gated on the project doing OTA at all, NOT on it being Expo-managed: a bare
 * tree shipping expo-updates can use the `fingerprint` policy too, and
 * recording its runtime version without the hash to correlate against leaves
 * `builds compatibility-matrix` unable to answer for exactly the builds this
 * gate exists to cover. Matches the gate in `upload-workflow`, so `build` and
 * `upload` record the same fields.
 */
const resolveFingerprintHash = (params: {
  readonly isExpo: boolean;
  readonly userCwd: string;
  readonly platform: Platform;
}) =>
  Effect.gen(function* () {
    const doesOta = params.isExpo || (yield* wantsOtaExpoConfig(params.userCwd));
    return doesOta
      ? yield* runFingerprintForPlatform(params.userCwd, params.platform).pipe(
          Effect.map((entry) => entry.hash),
          Effect.orElseSucceed(() => undefined),
        )
      : undefined;
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

      const updateChannel = yield* resolveUpdateChannel({ userCwd, profile });

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
        // Backup suppressor for `expo prebuild --clean`'s "Continue with
        // uncommitted changes?" git check (newer Expo only — older releases
        // ignore this env). The PRIMARY fix is committing the staged tree clean
        // in `prepareStagingProject` (see `commitStagingSnapshot`), which
        // neutralizes the prompt on every Expo version. The user-facing
        // dirty-tree gate already ran against the *real* working tree in
        // `ensureRepoClean` above — honoring --allow-dirty and failing fast
        // non-interactively — so Expo's downstream check is redundant here.
        EXPO_NO_GIT_STATUS: "1",
        ...compact({ BETTER_UPDATE_BUILD_GIT_COMMIT_HASH: rawGitContext.commit }),
      };

      // Resolve app metadata + OTA runtimeVersion. Expo reads app.json (with the
      // env overlay), applies autoIncrement to the user's tree, and derives a
      // runtimeVersion. Non-Expo reads app metadata from the native files /
      // profile overrides — but still derives a runtimeVersion when an Expo
      // config is present, because a bare project can ship expo-updates too.
      const { appMeta, runtimeVersion }: BuildMeta = isExpo
        ? yield* resolveExpoBuildMeta({ userCwd, platform, profile, envVars: envWithBuildId }).pipe(
            // autoIncrement is a read-modify-write of the user's app.json —
            // parallel platform builds must not interleave it.
            withOptionalPermit(options.mutex),
          )
        : yield* resolveNativeBuildMeta({
            userCwd,
            platform,
            profile,
            projectType,
            envVars: envWithBuildId,
          }).pipe(
            // Same permit as the Expo path, for a different hazard: reading the
            // Expo config overlays `process.env` and evicts `require.cache`
            // around the call, so two platform fibers doing it concurrently can
            // restore each other's snapshot and leak the wrong platform's
            // variables into the build steps that follow.
            withOptionalPermit(options.mutex),
          );

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
        ...compact({ copyMutex: options.mutex }),
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

      const buildOutcome = yield* Effect.result(
        runPlatformBuild({
          api,
          platform,
          profile,
          projectType,
          appMeta,
          envVars: buildEnv,
          // Clean user env (decrypted remote + profile.env), without the synthetic
          // BETTER_UPDATE_BUILD_* identity vars — materialized into `.env` for bare
          // react-native-config builds.
          appEnvVars: envVars,
          projectId,
          projectRoot: staging.projectRoot,
          tempDir,
          packageManager: staging.packageManager,
          updateChannel,
          freezeCredentials: options.freezeCredentials ?? false,
          rawOutput: options.rawOutput,
          ...compact({ mutex: options.mutex }),
        }),
      );

      const lifecycleStatus = Result.isSuccess(buildOutcome) ? "finished" : "errored";
      yield* runBuildLifecycleHooks({
        succeeded: Result.isSuccess(buildOutcome),
        projectRoot: staging.projectRoot,
        packageManager: staging.packageManager,
        env: yield* runtime.commandEnvironment({
          ...buildEnv,
          BETTER_UPDATE_BUILD_STATUS: lifecycleStatus,
          EAS_BUILD_STATUS: lifecycleStatus,
        }),
      });
      if (Result.isFailure(buildOutcome)) {
        return yield* Effect.fail(buildOutcome.failure);
      }
      const { build, target, bundleId } = buildOutcome.success;

      yield* printHuman(`Artifact produced: ${build.artifactPath}`);

      const exportedArtifactPath =
        options.output === undefined
          ? undefined
          : yield* exportArtifact({
              artifactPath: build.artifactPath,
              userCwd,
              output: options.output,
            });

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

      const fingerprintHash = yield* resolveFingerprintHash({ isExpo, userCwd, platform });

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

      // Best-effort: attach the captured crash-symbolication files (dSYM,
      // JS sourcemap, R8 mapping, NDK symbols) to the build record so a
      // future crash can be symbolicated by downloading them again.
      const storedDebugArtifacts =
        build.debugArtifacts.length === 0
          ? []
          : yield* uploadDebugArtifacts(api, {
              buildId: result.id,
              artifacts: build.debugArtifacts,
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
        [
          "Debug artifacts",
          storedDebugArtifacts.length === 0 ? "none" : storedDebugArtifacts.join(", "),
        ],
      ]);

      if (options.autoSubmit === true) {
        yield* runAutoSubmit({
          api,
          buildId: result.id,
          projectId,
          platform,
          profileName: options.autoSubmitProfile ?? profile.name,
          ...compact({ whatToTest: options.whatToTest }),
        }).pipe(
          // Submits can prompt (ASC key picker, Apple login) — serialize them
          // across parallel platform builds.
          withOptionalPermit(options.mutex),
        );
      }
    }),
  );
