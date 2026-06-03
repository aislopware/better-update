import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readBetterUpdateConfig } from "../lib/better-update-config";
import { readBuildProfile } from "../lib/build-profile";
import { asProjectType, detectProjectType } from "../lib/detect-project-type";
import { pullEnvVars } from "../lib/env-exporter";
import { ArtifactNotFoundError, BuildProfileError } from "../lib/exit-codes";
import { readAppMeta, readExpoConfig } from "../lib/expo-config";
import { runFingerprintForPlatform } from "../lib/fingerprint";
import { readGitContext } from "../lib/git-context";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
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

/** Resolve app metadata + OTA runtimeVersion for an upload (project-type aware). */
const resolveUploadMeta = (params: {
  readonly projectType: Effect.Effect.Success<ReturnType<typeof detectProjectType>>;
  readonly platform: Platform;
  readonly projectRoot: string;
  readonly profile: BuildProfile;
  readonly envVars: Record<string, string>;
}) =>
  Effect.gen(function* () {
    const { projectType, platform, projectRoot, profile, envVars } = params;
    const expoConfig =
      projectType === "expo" ? yield* readExpoConfig(projectRoot, envVars) : undefined;
    const expoAppMeta =
      expoConfig === undefined ? undefined : yield* readAppMeta(expoConfig, platform);
    const appMeta = yield* resolveAppMeta({
      projectType,
      platform,
      projectRoot,
      profile,
      ...compact({ expoConfig, expoAppMeta }),
    });
    const runtimeVersion =
      expoConfig === undefined
        ? undefined
        : yield* resolveRuntimeVersion({
            raw: appMeta.rawRuntimeVersion,
            appVersion: appMeta.appVersion,
            projectRoot,
            platform,
            buildNumber: appMeta.buildNumber,
            sdkVersion: expoConfig.sdkVersion,
          });
    return { appMeta, runtimeVersion, isExpo: expoConfig !== undefined };
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

    const buConfig = yield* readBetterUpdateConfig(projectRoot);
    const projectType = yield* detectProjectType({
      projectRoot,
      override: asProjectType(buConfig?.["projectType"]),
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

    const { appMeta, runtimeVersion, isExpo } = yield* resolveUploadMeta({
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
    // per-platform `fingerprint`-policy RTV. Expo-only — non-Expo has no OTA.
    const fingerprintHash = isExpo
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
