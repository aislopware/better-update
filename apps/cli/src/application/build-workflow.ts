import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import { runAndroidBuild } from "../commands/build/android";
import { runIosBuild } from "../commands/build/ios";
import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { applyAutoIncrement } from "../lib/auto-increment";
import { readBuildProfile } from "../lib/build-profile";
import { clearBuildCaches } from "../lib/clear-cache";
import { warnIfDevClientMissing } from "../lib/dev-client-check";
import { readEasJson, resolveEasSubmitProfile } from "../lib/eas-config";
import { pullEnvVars } from "../lib/env-exporter";
import { BuildProfileError } from "../lib/exit-codes";
import { extractProjectId, readAppMeta, readExpoConfig } from "../lib/expo-config";
import { runFingerprintFull } from "../lib/fingerprint";
import { formatCause } from "../lib/format-error";
import { readGitContext } from "../lib/git-context";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman, printKeyValue } from "../lib/output";
import { detectPlatform } from "../lib/platform-detect";
import { prepareStagingProject } from "../lib/project-staging";
import { promptSelect } from "../lib/prompts";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { ensureAndroidCredentials, ensureIosCredentials } from "./credentials-interactive";
import {
  createSubmissionViaApi,
  pollSubmissionUntilTerminal,
  runIosAltoolUpload,
} from "./submit-flow";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { Platform } from "../lib/build-profile";
import type { EasAndroidSubmitProfile, EasIosSubmitProfile } from "../lib/eas-config";

interface AutoSubmitInput {
  readonly api: ApiClient;
  readonly buildId: string;
  readonly projectId: string;
  readonly platform: Platform;
  readonly profileName: string;
  readonly whatToTest?: string;
}

const buildAutoSubmitIosConfig = (
  iosProfile: EasIosSubmitProfile | undefined,
  whatToTest: string | undefined,
) => {
  if (iosProfile?.bundleIdentifier === undefined) {
    return undefined;
  }
  return {
    bundleIdentifier: iosProfile.bundleIdentifier,
    ...(iosProfile.appleId === undefined ? {} : { appleId: iosProfile.appleId }),
    ...(iosProfile.ascAppId === undefined ? {} : { ascAppId: iosProfile.ascAppId }),
    ...(iosProfile.appleTeamId === undefined ? {} : { appleTeamId: iosProfile.appleTeamId }),
    ...(iosProfile.sku === undefined ? {} : { sku: iosProfile.sku }),
    ...(iosProfile.language === undefined ? {} : { language: iosProfile.language }),
    ...(iosProfile.companyName === undefined ? {} : { companyName: iosProfile.companyName }),
    ...(iosProfile.appName === undefined ? {} : { appName: iosProfile.appName }),
    ...(iosProfile.groups === undefined ? {} : { groups: iosProfile.groups }),
    ...(whatToTest === undefined ? {} : { whatToTest }),
  };
};

const buildAutoSubmitAndroidConfig = (androidProfile: EasAndroidSubmitProfile | undefined) => {
  if (androidProfile?.applicationId === undefined) {
    return undefined;
  }
  return {
    applicationId: androidProfile.applicationId,
    ...(androidProfile.track === undefined ? {} : { track: androidProfile.track }),
    ...(androidProfile.releaseStatus === undefined
      ? {}
      : { releaseStatus: androidProfile.releaseStatus }),
    ...(androidProfile.changesNotSentForReview === undefined
      ? {}
      : { changesNotSentForReview: androidProfile.changesNotSentForReview }),
    ...(androidProfile.rollout === undefined ? {} : { rollout: androidProfile.rollout }),
  };
};

const runAutoSubmit = (input: AutoSubmitInput) =>
  Effect.gen(function* () {
    yield* printHuman(`\nAuto-submitting build ${input.buildId} (profile ${input.profileName})...`);
    const easConfig = yield* readEasJson(process.cwd());
    const easProfile = yield* resolveEasSubmitProfile(easConfig.submit, input.profileName);

    const installLink = yield* input.api.builds.getInstallLink({ path: { id: input.buildId } });
    const archiveUrl = installLink.artifactUrl;

    const iosConfig =
      input.platform === "ios"
        ? buildAutoSubmitIosConfig(easProfile.ios, input.whatToTest)
        : undefined;
    const androidConfig =
      input.platform === "android" ? buildAutoSubmitAndroidConfig(easProfile.android) : undefined;

    const submission = yield* createSubmissionViaApi(input.api, {
      projectId: input.projectId,
      platform: input.platform,
      profileName: input.profileName,
      archiveSource: "build",
      buildId: input.buildId,
      archiveUrl,
      ...(iosConfig === undefined ? {} : { iosConfig }),
      ...(androidConfig === undefined ? {} : { androidConfig }),
    });

    yield* printHuman(`Submission created: ${submission.id} (${submission.status})`);

    if (input.platform === "ios" && easProfile.ios?.ascApiKeyId !== undefined) {
      yield* printHuman("Running xcrun altool upload...");
      yield* runIosAltoolUpload({
        api: input.api,
        submissionId: submission.id,
        ipaPath: archiveUrl,
        ascApiKeyId: easProfile.ios.ascApiKeyId,
      });
    }

    const terminal = yield* pollSubmissionUntilTerminal(input.api, submission.id);
    yield* printHuman(`Submission final status: ${terminal.status}`);
  });

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
      freezeCredentials: options.freezeCredentials ?? false,
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
    // EAS parity: developmentClient=true or withoutCredentials=true skips the
    // server keystore lookup so dev builds work without registering a keystore.
    const skipCredentials =
      profile.developmentClient === true || profile.withoutCredentials === true;
    if (credentialsSource === "remote" && !skipCredentials) {
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
      profileName: profile.name,
      skipCredentials,
    });
    const target: BuildTarget =
      androidProfile.format === "aab"
        ? { platform: "android", distribution: "play-store", artifactFormat: "aab" }
        : { platform: "android", distribution: "direct", artifactFormat: "apk" };
    return { build, target, bundleId: applicationIdentifier };
  });

const runPlatformBuild = (input: PlatformBuildInput) =>
  input.platform === "ios" ? runIosPlatformBuild(input) : runAndroidPlatformBuild(input);

const resolveProfileName = (projectRoot: string, requested: string) =>
  Effect.gen(function* () {
    const easConfig = yield* readEasJson(projectRoot);
    const available = Object.keys(easConfig.build ?? {});
    if (available.includes(requested)) {
      return requested;
    }
    const mode = yield* InteractiveMode;
    if (!mode.allow || available.length === 0) {
      // Let readBuildProfile fail with its existing "not found" message,
      // or with the empty-build-section message when applicable.
      return requested;
    }
    yield* Console.log(`Build profile "${requested}" not found in eas.json.`);
    return yield* promptSelect<string>(
      "Pick a build profile:",
      available.map((name) => ({ value: name, label: name })),
    );
  });

export const runBuildWorkflow = (options: RunBuildWorkflowOptions) =>
  Effect.scoped(
    // eslint-disable-next-line eslint/max-statements, eslint/complexity -- build orchestration is inherently sequential (read config → detect platform → resolve profile → pull env → build → upload → optional submit); splitting further fragments the pipeline
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

      // Read the project's Expo config to extract projectId.
      const baseConfig = yield* readExpoConfig(userCwd);
      const projectId = yield* extractProjectId(baseConfig);
      const platform = yield* detectPlatform(options.platform, baseConfig);

      // Resolve profile name — when the requested profile is missing in
      // eas.json AND we're interactive, offer a picker over the available
      // profiles. In CI we let readBuildProfile error with its hint.
      const profileName = yield* resolveProfileName(userCwd, options.profileName);

      // Resolve the build profile from eas.json — static, env-independent.
      const profile = yield* readBuildProfile(userCwd, profileName);

      if (profile.developmentClient === true) {
        yield* warnIfDevClientMissing(userCwd);
      }

      // Pull env vars for the profile's environment scope, then overlay the
      // eas.json profile.env block on top. EAS precedence: keys defined in
      // eas.json win over remote values when both define the same key.
      const remoteEnvVars = yield* pullEnvVars(api, {
        projectId,
        environment: profile.environment,
      });
      const envVars = { ...remoteEnvVars, ...profile.env };

      // Re-resolve the Expo config with the env overlay so dynamic configs
      // (app.config.js/ts) can read these env vars when computing AppMeta
      // (bundleId, version, runtimeVersion). envVars are scoped to the call
      // so they don't leak to child processes.
      const expoConfig = yield* readExpoConfig(userCwd, envVars);

      // Apply autoIncrement BEFORE staging so the bumped app.json persists in
      // the user's working tree (next build picks up the new value) and the
      // staged copy inherits it via the copy step.
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
      const appMeta = yield* readAppMeta(bumpedConfig, platform);

      const runtimeVersion = yield* resolveRuntimeVersion({
        raw: appMeta.rawRuntimeVersion,
        appVersion: appMeta.appVersion,
        projectRoot: userCwd,
      });

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
        envVars,
      });

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
        projectRoot: staging.projectRoot,
        tempDir,
      });
      const { build, target, bundleId } = outcome;

      yield* Console.log(`Artifact produced: ${build.artifactPath}`);

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
          ...(exportedArtifactPath === undefined
            ? []
            : [["Exported to", exportedArtifactPath] as const]),
          ["SHA-256", build.sha256],
          ["Bytes", String(build.byteSize)],
          ["Upload", "skipped (--no-upload)"],
        ]);
        return;
      }

      const rawGitContext = yield* readGitContext(userCwd);
      const gitContext: {
        readonly ref?: string;
        readonly commit?: string;
        readonly dirty: boolean;
      } = {
        ...(rawGitContext.ref === undefined ? {} : { ref: rawGitContext.ref }),
        ...(rawGitContext.commit === undefined ? {} : { commit: rawGitContext.commit }),
        dirty: rawGitContext.dirty,
      };

      const fingerprintHash = yield* runFingerprintFull(userCwd).pipe(
        Effect.map((entry) => entry.hash),
        Effect.catchAll(() => Effect.succeed(undefined)),
      );

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
        ...(fingerprintHash === undefined ? {} : { fingerprintHash }),
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

      if (options.autoSubmit === true) {
        yield* runAutoSubmit({
          api,
          buildId: result.id,
          projectId,
          platform,
          profileName: options.autoSubmitProfile ?? profile.name,
          ...(options.whatToTest === undefined ? {} : { whatToTest: options.whatToTest }),
        });
      }
    }),
  );
