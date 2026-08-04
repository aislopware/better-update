import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readBuildProfile } from "../lib/build-profile";
import { asProjectType, detectProjectType } from "../lib/detect-project-type";
import { readEasProjectType } from "../lib/eas-json";
import { pullEnvVars } from "../lib/env-exporter";
import { ArtifactNotFoundError, BuildProfileError } from "../lib/exit-codes";
import { extractRawRuntimeVersion, readAppMeta, readExpoConfig } from "../lib/expo-config";
import { runFingerprintForPlatform } from "../lib/fingerprint";
import { readGitContext } from "../lib/git-context";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { readOtaExpoConfig } from "../lib/ota-expo-config";
import { printHuman, printKeyValue } from "../lib/output";
import { readProjectId } from "../lib/project-link";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { sha256File } from "../lib/sha256";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { resolveAppMeta } from "./resolve-app-meta";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { AppMeta, BuildProfile, Platform } from "../lib/build-profile";

export interface RunUploadWorkflowOptions {
  readonly platform: Platform;
  readonly profileName: string;
  readonly artifactPath: string;
  readonly message: string | undefined;
}

interface ResolvedTarget {
  readonly target: BuildTarget;
  readonly bundleId: string;
}

const resolveIosTarget = (
  profile: BuildProfile,
  appMeta: AppMeta,
): Effect.Effect<ResolvedTarget, BuildProfileError> =>
  Effect.gen(function* () {
    if (!profile.ios) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no ios section.`,
      });
    }
    if (!appMeta.bundleId) {
      return yield* new BuildProfileError({
        message: "Missing iOS bundle identifier (set ios.bundleIdentifier or your Expo config).",
      });
    }
    return {
      target: {
        platform: "ios",
        distribution: profile.ios.distribution,
        artifactFormat: "ipa",
      },
      bundleId: appMeta.bundleId,
    };
  });

const resolveAndroidTarget = (profile: BuildProfile, appMeta: AppMeta, projectRoot: string) =>
  Effect.gen(function* () {
    if (!profile.android) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no android section.`,
      });
    }
    if (!appMeta.androidPackage) {
      return yield* new BuildProfileError({
        message: "Missing Android applicationId (set android.applicationId or your Expo config).",
      });
    }
    const gradleConfig = yield* readGradleConfig(`${projectRoot}/android`);
    yield* warnOnGradleMismatch(gradleConfig, appMeta.androidPackage);
    const bundleId = gradleConfig?.applicationId ?? appMeta.androidPackage;
    const target: BuildTarget =
      profile.android.format === "aab"
        ? { platform: "android", distribution: "play-store", artifactFormat: "aab" }
        : { platform: "android", distribution: "direct", artifactFormat: "apk" };
    return { target, bundleId };
  });

/**
 * Resolve app metadata + OTA runtimeVersion for an upload.
 *
 * Two SEPARATE questions, previously answered by one flag:
 *
 *   1. Where does app metadata come from?  -> the project type. An Expo project
 *      reads app.json; bare/native/kmp read the native files. Unchanged.
 *   2. Is there an OTA runtimeVersion?     -> whether an Expo config exists and
 *      declares one. A bare project can ship expo-updates and commit its own
 *      `ios/`+`android/`; gating this on the project type recorded an empty
 *      runtime version for exactly those builds, which is what made
 *      `builds compatibility-matrix` report "No compatibility data found".
 *
 * Reading the Expo config is best-effort for question 2: a project that merely
 * happens to have an app.json must not start failing its uploads because that
 * file is unreadable. It falls back to the previous behaviour (no
 * runtimeVersion). Question 1 keeps failing hard — an Expo project whose config
 * will not parse has no app metadata to upload at all.
 */
const resolveUploadMeta = (params: {
  readonly projectType: Effect.Effect.Success<ReturnType<typeof detectProjectType>>;
  readonly platform: Platform;
  readonly projectRoot: string;
  readonly profile: BuildProfile;
  readonly envVars: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const { projectType, platform, projectRoot, profile, envVars } = params;
    const isExpoProject = projectType === "expo";
    // Question 1 (Expo project): the config IS the app metadata, so an
    // unreadable one is fatal and the read stays un-caught — that keeps the
    // error channel typed as ProjectNotLinkedError rather than collapsing to
    // `unknown` and swallowing every other typed failure of this workflow.
    // Question 2 (everyone else): best-effort, and only when the project ships
    // expo-updates at all.
    const expoConfig = isExpoProject
      ? yield* readExpoConfig(projectRoot, envVars)
      : yield* readOtaExpoConfig({ projectRoot, envVars, subject: "upload" });
    // Only an Expo project takes its app metadata from the config; for the
    // others the native files remain the source of truth.
    const expoAppMeta =
      isExpoProject && expoConfig !== undefined
        ? yield* readAppMeta(expoConfig, platform)
        : undefined;
    const appMeta = yield* resolveAppMeta({
      projectType,
      platform,
      projectRoot,
      profile,
      ...compact({ expoConfig: isExpoProject ? expoConfig : undefined, expoAppMeta }),
    });
    // `appMeta.rawRuntimeVersion` is only populated on the Expo path, so read it
    // straight off the config for everyone else.
    const readRawRuntimeVersion = () => {
      if (expoConfig === undefined) {
        return undefined;
      }
      return isExpoProject
        ? appMeta.rawRuntimeVersion
        : extractRawRuntimeVersion(expoConfig, platform);
    };
    const rawRuntimeVersion = readRawRuntimeVersion();
    const runtimeVersion =
      expoConfig === undefined || rawRuntimeVersion === undefined
        ? undefined
        : yield* resolveRuntimeVersion({
            raw: rawRuntimeVersion,
            appVersion: appMeta.appVersion,
            projectRoot,
            platform,
            buildNumber: appMeta.buildNumber,
            sdkVersion: expoConfig.sdkVersion,
          });
    // Named for what it is: the fingerprint probe below needs an Expo config,
    // NOT an Expo project. Calling it `isExpo` was how the two got conflated in
    // the first place.
    return { appMeta, runtimeVersion, hasExpoConfig: expoConfig !== undefined };
  });

export const runUploadWorkflow = (options: RunUploadWorkflowOptions) =>
  Effect.gen(function* () {
    const api = yield* apiClient;
    const runtime = yield* CliRuntime;
    const projectRoot = yield* runtime.cwd;

    const fs = yield* FileSystem.FileSystem;
    const artifactExists = yield* fs
      .exists(options.artifactPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!artifactExists) {
      return yield* new ArtifactNotFoundError({
        message: `Artifact not found at ${options.artifactPath}.`,
      });
    }

    const projectType = yield* detectProjectType({
      projectRoot,
      override: asProjectType(yield* readEasProjectType(projectRoot)),
    });
    const projectId = yield* readProjectId;
    const profile = yield* readBuildProfile(projectRoot, options.profileName);

    // Pull env vars for the profile's environment scope, then overlay the
    // profile.env block on top (profile keys win over remote on collision).
    const remoteEnvVars = yield* pullEnvVars(api, {
      projectId,
      environment: profile.environment,
    });
    const envVars = { ...remoteEnvVars, ...profile.env };

    const { appMeta, runtimeVersion, hasExpoConfig } = yield* resolveUploadMeta({
      projectType,
      platform: options.platform,
      projectRoot,
      profile,
      envVars,
    });

    const { target, bundleId } =
      options.platform === "ios"
        ? yield* resolveIosTarget(profile, appMeta)
        : yield* resolveAndroidTarget(profile, appMeta, projectRoot);

    yield* printHuman(`Hashing ${options.artifactPath}...`);
    const { sha256, byteSize } = yield* sha256File(options.artifactPath);

    const rawGitContext = yield* readGitContext(projectRoot);
    const gitContext = compact({
      ref: rawGitContext.ref,
      commit: rawGitContext.commit,
      dirty: rawGitContext.dirty,
    });

    // Per-platform fingerprint (matching EAS) so the recorded hash matches the
    // per-platform `fingerprint`-policy RTV. Gated on an Expo config being
    // readable — a project doing OTA from a bare tree needs this hash just as
    // much as a managed one, and a project without OTA has nothing to fingerprint.
    const fingerprintHash = hasExpoConfig
      ? yield* runFingerprintForPlatform(projectRoot, options.platform).pipe(
          Effect.map((entry) => entry.hash),
          Effect.orElseSucceed(() => undefined),
        )
      : undefined;

    const result = yield* reserveAndUpload(
      api,
      compact({
        target,
        projectId,
        profileName: profile.name,
        runtimeVersion,
        appVersion: appMeta.appVersion,
        buildNumber: appMeta.buildNumber,
        bundleId,
        gitContext,
        message: options.message,
        fingerprintHash,
        artifactPath: options.artifactPath,
        sha256,
        byteSize,
      }),
    );

    yield* printHuman("");
    yield* printKeyValue([
      ["Build ID", result.id],
      ["Status", result.status],
      ["Platform", options.platform],
      ["Profile", profile.name],
      ...(runtimeVersion === undefined ? [] : [["Runtime version", runtimeVersion] as const]),
      ["Artifact", options.artifactPath],
      ["SHA-256", sha256],
      ["Bytes", String(byteSize)],
    ]);
  });
