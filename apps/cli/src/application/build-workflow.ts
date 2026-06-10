import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { runAndroidBuild } from "../commands/build/android";
import { runIosBuild } from "../commands/build/ios";
import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { applyAutoIncrement } from "../lib/auto-increment";
import { readBuildProfile } from "../lib/build-profile";
import { resolveAndroidStrategy, resolveIosStrategy } from "../lib/build-strategy";
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
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { InteractiveMode } from "../lib/interactive-mode";
import { printHuman, printKeyValue } from "../lib/output";
import { detectPlatform, detectPlatformGeneric } from "../lib/platform-detect";
import { readProjectId } from "../lib/project-link";
import { prepareStagingProject } from "../lib/project-staging";
import { promptSelect } from "../lib/prompts";
import { ensureRepoClean } from "../lib/repo-clean";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { acquireBuildTempDir } from "../lib/temp-dir";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { runAutoSubmit } from "./build-auto-submit";
import { ensureAndroidCredentials, ensureIosCredentials } from "./credentials-interactive";
import { resolveAppMeta } from "./resolve-app-meta";
import { resolveUpdateChannel } from "./resolve-update-channel";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { Platform } from "../lib/build-profile";
import type { ProjectType } from "../lib/detect-project-type";

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
  readonly projectType: ProjectType;
  readonly appMeta: AppMeta;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly tempDir: string;
  /** Channel baked into the native app at prebuild; undefined skips injection. */
  readonly updateChannel: string | undefined;
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
        message: "Missing iOS bundle identifier (set ios.bundleIdentifier or your Expo config).",
      });
    }
    const strategy = resolveIosStrategy(profile, input.projectType);
    const isSimulator = iosProfile.simulator === true;
    const credentialsSource = profile.credentialsSource ?? "remote";
    // Custom builds own their own signing; only the native xcodebuild path needs
    // server-managed credentials pre-ensured here.
    if (strategy !== "custom" && !isSimulator && credentialsSource === "remote") {
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
      strategy,
      rawOutput: options.rawOutput,
      freezeCredentials: options.freezeCredentials ?? false,
      updateChannel: input.updateChannel,
      ...compact({ customCommand: profile.customCommand?.ios }),
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
        message: "Missing Android applicationId (set android.applicationId or your Expo config).",
      });
    }
    const strategy = resolveAndroidStrategy(profile, input.projectType);
    // Cross-validate Gradle config against the resolved package (Groovy only).
    // When Gradle resolves a different applicationId, the built APK/AAB is signed
    // under that id — so the credential resolver must key off the Gradle value.
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
      strategy,
      updateChannel: input.updateChannel,
      ...compact({ customCommand: profile.customCommand?.android }),
    });
    const target: BuildTarget =
      androidProfile.format === "aab"
        ? { platform: "android", distribution: "play-store", artifactFormat: "aab" }
        : { platform: "android", distribution: "direct", artifactFormat: "apk" };
    return { build, target, bundleId: applicationIdentifier };
  });

const runPlatformBuild = (input: PlatformBuildInput) =>
  input.platform === "ios" ? runIosPlatformBuild(input) : runAndroidPlatformBuild(input);

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

      // Resolve app metadata + OTA runtimeVersion. Expo reads app.json (with the
      // env overlay), applies autoIncrement to the user's tree, and derives a
      // runtimeVersion. Non-Expo reads native files / profile overrides and has
      // no runtimeVersion (no eas-updates).
      const { appMeta, runtimeVersion }: BuildMeta = isExpo
        ? yield* resolveExpoBuildMeta({ userCwd, platform, profile, envVars })
        : {
            appMeta: yield* resolveAppMeta({
              projectType,
              platform,
              projectRoot: userCwd,
              profile,
            }),
            runtimeVersion: undefined,
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
        envVars,
        projectType,
      });

      const buildDetails = [
        ...(runtimeVersion === undefined ? [] : [`runtimeVersion=${runtimeVersion}`]),
        ...(updateChannel === undefined ? [] : [`channel=${updateChannel}`]),
      ];
      yield* printHuman(
        `Building ${platform} artifact for profile "${profile.name}"${
          buildDetails.length === 0 ? "" : ` (${buildDetails.join(", ")})`
        }`,
      );

      const outcome = yield* runPlatformBuild({
        api,
        options,
        platform,
        profile,
        projectType,
        appMeta,
        envVars,
        projectId,
        projectRoot: staging.projectRoot,
        tempDir,
        updateChannel,
      });
      const { build, target, bundleId } = outcome;

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

      const rawGitContext = yield* readGitContext(userCwd);
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
