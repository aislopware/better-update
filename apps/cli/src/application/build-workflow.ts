import { Console, Effect } from "effect";

import { runAndroidBuild } from "../commands/build/android";
import { runIosBuild } from "../commands/build/ios";
import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readBuildProfile } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { BuildProfileError } from "../lib/exit-codes";
import { extractProjectId, readAppMeta, readExpoConfig } from "../lib/expo-config";
import { readGitContext } from "../lib/git-context";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { printKeyValue } from "../lib/output";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { Platform } from "../lib/build-profile";

export interface RunBuildWorkflowOptions {
  readonly platform: Platform;
  readonly profileName: string;
  readonly message: string | undefined;
  readonly noUpload: boolean;
  readonly rawOutput?: boolean;
}

type AppMeta = Effect.Effect.Success<ReturnType<typeof readAppMeta>>;
type BuildProfile = Effect.Effect.Success<ReturnType<typeof readBuildProfile>>;
type ApiClient = Effect.Effect.Success<typeof apiClient>;

interface PlatformBuildInput {
  readonly api: ApiClient;
  readonly options: RunBuildWorkflowOptions;
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
    const build = yield* runIosBuild({
      api,
      tempDir,
      projectRoot,
      iosProfile,
      bundleId: iosBundleId,
      envVars,
      projectId,
      rawOutput: options.rawOutput,
    });
    const target: BuildTarget = {
      platform: "ios",
      distribution: iosProfile.distribution,
      artifactFormat: "ipa",
    };
    return { build, target, bundleId: iosBundleId };
  });

const runAndroidPlatformBuild = (input: PlatformBuildInput) =>
  Effect.gen(function* () {
    const { api, appMeta, envVars, profile, projectId, projectRoot, tempDir } = input;
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
    const build = yield* runAndroidBuild({
      api,
      tempDir,
      projectRoot,
      androidProfile,
      applicationIdentifier,
      envVars,
      projectId,
    });
    const target: BuildTarget =
      androidProfile.format === "aab"
        ? { platform: "android", distribution: "play-store", artifactFormat: "aab" }
        : { platform: "android", distribution: "direct", artifactFormat: "apk" };
    return { build, target, bundleId: applicationIdentifier };
  });

const runPlatformBuild = (input: PlatformBuildInput) =>
  input.options.platform === "ios" ? runIosPlatformBuild(input) : runAndroidPlatformBuild(input);

export const runBuildWorkflow = (options: RunBuildWorkflowOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const api = yield* apiClient;
      const runtime = yield* CliRuntime;
      const projectRoot = yield* runtime.cwd;

      // Read config first without env vars to learn the build profile + projectId.
      // app.config.{js,ts} that reads process.env for these fields will see the
      // caller's environment only — env vars from the server are not available yet.
      const baseConfig = yield* readExpoConfig(projectRoot);
      const projectId = yield* extractProjectId(baseConfig);
      const profile = yield* readBuildProfile(baseConfig, options.profileName);

      // Load env vars now that we know the profile's environment.
      const envVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });

      // Re-resolve config with env-var overlay so dynamic configs see them.
      // EnvVars are applied as a scoped process.env overlay inside readExpoConfig
      // And restored after the call so secrets do not leak to child processes.
      const expoConfig = yield* readExpoConfig(projectRoot, envVars);
      const appMeta = yield* readAppMeta(expoConfig, options.platform);

      const runtimeVersion = yield* resolveRuntimeVersion({
        raw: appMeta.rawRuntimeVersion,
        appVersion: appMeta.appVersion,
        projectRoot,
      });

      const tempDir = yield* acquireBuildTempDir;

      yield* Console.log(
        `Building ${options.platform} artifact for profile "${profile.name}" (runtimeVersion=${runtimeVersion})`,
      );

      const outcome = yield* runPlatformBuild({
        api,
        options,
        profile,
        appMeta,
        envVars,
        projectId,
        projectRoot,
        tempDir,
      });
      const { build, target, bundleId } = outcome;

      yield* Console.log(`Artifact produced: ${build.artifactPath}`);

      if (options.noUpload) {
        yield* printKeyValue([
          ["Artifact", build.artifactPath],
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
        ["Platform", options.platform],
        ["Profile", profile.name],
        ["Runtime version", runtimeVersion],
        ["Artifact", build.artifactPath],
        ["SHA-256", build.sha256],
        ["Bytes", String(build.byteSize)],
      ]);
    }),
  );
