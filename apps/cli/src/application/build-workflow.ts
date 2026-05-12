import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import { runAndroidBuild } from "../commands/build/android";
import { runIosBuild } from "../commands/build/ios";
import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readBuildProfile } from "../lib/build-profile";
import { clearBuildCaches } from "../lib/clear-cache";
import { pullEnvVars } from "../lib/env-exporter";
import { BuildProfileError } from "../lib/exit-codes";
import { extractProjectId, readAppMeta, readExpoConfig } from "../lib/expo-config";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { printHuman, printKeyValue } from "../lib/output";
import { detectPlatform } from "../lib/platform-detect";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { ensureAndroidCredentials, ensureIosCredentials } from "./credentials-interactive";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { Platform } from "../lib/build-profile";

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
}

type AppMeta = Effect.Effect.Success<ReturnType<typeof readAppMeta>>;
type BuildProfile = Effect.Effect.Success<ReturnType<typeof readBuildProfile>>;
type ApiClient = Effect.Effect.Success<typeof apiClient>;

interface PlatformBuildInput {
  readonly api: ApiClient;
  readonly options: RunBuildWorkflowOptions;
  readonly platform: Platform;
  readonly profile: BuildProfile;
  readonly appMeta: AppMeta;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly tempDir: string;
}

const runIosPlatformBuild = (input: PlatformBuildInput) =>
  Effect.gen(function* () {
    const { api, appMeta, envVars, options, profile, projectId, projectRoot, tempDir } = input;
    if (!profile.ios) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no ios section.`,
      });
    }
    const iosProfile = profile.ios;
    const iosBundleId = appMeta.bundleId;
    if (!iosBundleId) {
      return yield* new BuildProfileError({
        message: "Missing ios.bundleIdentifier in your Expo config.",
      });
    }
    const isSimulator = iosProfile.simulator === true;
    const credentialsSource = profile.credentialsSource ?? "remote";
    if (!isSimulator && credentialsSource === "remote") {
      yield* ensureIosCredentials(
        api,
        {
          projectId,
          bundleIdentifier: iosBundleId,
          distribution: iosProfile.distribution,
        },
        { freezeCredentials: options.freezeCredentials ?? false },
      );
    }
    const build = yield* runIosBuild({
      api,
      tempDir,
      projectRoot,
      iosProfile,
      bundleId: iosBundleId,
      envVars,
      projectId,
      credentialsSource,
      rawOutput: options.rawOutput,
    });
    const target: BuildTarget = isSimulator
      ? { platform: "ios", distribution: "simulator", artifactFormat: "tar.gz" }
      : { platform: "ios", distribution: iosProfile.distribution, artifactFormat: "ipa" };
    return { build, target, bundleId: iosBundleId };
  });

const runAndroidPlatformBuild = (input: PlatformBuildInput) =>
  Effect.gen(function* () {
    const { api, appMeta, envVars, options, profile, projectId, projectRoot, tempDir } = input;
    if (!profile.android) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no android section.`,
      });
    }
    const androidProfile = profile.android;
    const androidBundleId = appMeta.androidPackage;
    if (!androidBundleId) {
      return yield* new BuildProfileError({
        message: "Missing android.package in your Expo config.",
      });
    }
    // Cross-validate Gradle config against the Expo config (Groovy only). When
    // Gradle resolves a different applicationId, the built APK/AAB is signed
    // Under that id — so the Credential resolver must key off the Gradle value.
    const androidDir = `${projectRoot}/android`;
    const gradleConfig = yield* readGradleConfig(androidDir);
    yield* warnOnGradleMismatch(gradleConfig, androidBundleId);
    const applicationIdentifier = gradleConfig?.applicationId ?? androidBundleId;
    const credentialsSource = profile.credentialsSource ?? "remote";
    if (credentialsSource === "remote") {
      yield* ensureAndroidCredentials(
        api,
        { projectId, applicationIdentifier },
        { freezeCredentials: options.freezeCredentials ?? false },
      );
    }
    const build = yield* runAndroidBuild({
      api,
      tempDir,
      projectRoot,
      androidProfile,
      applicationIdentifier,
      envVars,
      projectId,
      credentialsSource,
    });
    const target: BuildTarget =
      androidProfile.format === "aab"
        ? { platform: "android", distribution: "play-store", artifactFormat: "aab" }
        : { platform: "android", distribution: "direct", artifactFormat: "apk" };
    return { build, target, bundleId: applicationIdentifier };
  });

const runPlatformBuild = (input: PlatformBuildInput) =>
  input.platform === "ios" ? runIosPlatformBuild(input) : runAndroidPlatformBuild(input);

export const runBuildWorkflow = (options: RunBuildWorkflowOptions) =>
  Effect.scoped(
    // eslint-disable-next-line eslint/max-statements -- build orchestration is inherently sequential (read config → detect platform → resolve profile → pull env → build → upload); splitting further fragments the pipeline
    Effect.gen(function* () {
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;

      yield* ensureRepoClean({
        projectRoot,
        allowDirty: options.allowDirty ?? false,
        label: "build",
      });

      // Read the project's Expo config to extract projectId.
      const baseConfig = yield* readExpoConfig(projectRoot);
      const projectId = yield* extractProjectId(baseConfig);
      const platform = yield* detectPlatform(options.platform, baseConfig);

      // Resolve the build profile from eas.json — static, env-independent.
      const profile = yield* readBuildProfile(projectRoot, options.profileName);

      // Pull env vars for the profile's environment scope.
      const envVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });

      // Re-resolve the Expo config with the env overlay so dynamic configs
      // (app.config.js/ts) can read these env vars when computing AppMeta
      // (bundleId, version, runtimeVersion). envVars are scoped to the call
      // so they don't leak to child processes.
      const expoConfig = yield* readExpoConfig(projectRoot, envVars);
      const appMeta = yield* readAppMeta(expoConfig, platform);

      const runtimeVersion = yield* resolveRuntimeVersion({
        raw: appMeta.rawRuntimeVersion,
        appVersion: appMeta.appVersion,
        projectRoot,
      });

      if (options.clearCache) {
        yield* clearBuildCaches(projectRoot);
      }

      const tempDir = yield* acquireBuildTempDir;

      yield* Console.log(
        `Building ${platform} artifact for profile "${profile.name}" (runtimeVersion=${runtimeVersion})`,
      );

      const outcome = yield* runPlatformBuild({
        api,
        options,
        platform,
        profile,
        appMeta,
        envVars,
        projectId,
        projectRoot,
        tempDir,
      });
      const { build, target, bundleId } = outcome;

      yield* Console.log(`Artifact produced: ${build.artifactPath}`);

      let exportedArtifactPath: string | undefined = undefined;
      if (options.output !== undefined) {
        const fs = yield* FileSystem.FileSystem;
        const outputPath = path.resolve(projectRoot, options.output);
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
          ...(exportedArtifactPath === undefined
            ? []
            : [["Exported to", exportedArtifactPath] as const]),
          ["SHA-256", build.sha256],
          ["Bytes", String(build.byteSize)],
          ["Upload", "skipped (--no-upload)"],
        ]);
        return;
      }

      const rawGitContext = yield* readGitContext(projectRoot);
      const gitContext: {
        readonly ref?: string;
        readonly commit?: string;
        readonly dirty: boolean;
      } = {
        ...(rawGitContext.ref === undefined ? {} : { ref: rawGitContext.ref }),
        ...(rawGitContext.commit === undefined ? {} : { commit: rawGitContext.commit }),
        dirty: rawGitContext.dirty,
      };

      const result = yield* reserveAndUpload(api, {
        target,
        projectId,
        profileName: profile.name,
        runtimeVersion,
        ...(appMeta.appVersion === undefined ? {} : { appVersion: appMeta.appVersion }),
        ...(appMeta.buildNumber === undefined ? {} : { buildNumber: appMeta.buildNumber }),
        bundleId,
        gitContext,
        ...(options.message === undefined ? {} : { message: options.message }),
        artifactPath: build.artifactPath,
        sha256: build.sha256,
        byteSize: build.byteSize,
      });

      yield* Console.log("");
      yield* printKeyValue([
        ["Build ID", result.id],
        ["Status", result.status],
        ["Platform", platform],
        ["Profile", profile.name],
        ["Runtime version", runtimeVersion],
        ["Artifact", build.artifactPath],
        ["SHA-256", build.sha256],
        ["Bytes", String(build.byteSize)],
      ]);
    }),
  );
