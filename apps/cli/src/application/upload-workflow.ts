import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

import { reserveAndUpload } from "../commands/build/reserve-and-upload";
import { readBuildProfile } from "../lib/build-profile";
import { pullEnvVars } from "../lib/env-exporter";
import { ArtifactNotFoundError, BuildProfileError } from "../lib/exit-codes";
import { extractProjectId, readAppMeta, readExpoConfig } from "../lib/expo-config";
import { readGitContext } from "../lib/git-context";
import { readGradleConfig, warnOnGradleMismatch } from "../lib/gradle-config";
import { printKeyValue } from "../lib/output";
import { resolveRuntimeVersion } from "../lib/runtime-version";
import { sha256File } from "../lib/sha256";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";

import type { BuildTarget } from "../commands/build/reserve-and-upload";
import type { Platform } from "../lib/build-profile";

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
  profile: Effect.Effect.Success<ReturnType<typeof readBuildProfile>>,
  appMeta: Effect.Effect.Success<ReturnType<typeof readAppMeta>>,
): Effect.Effect<ResolvedTarget, BuildProfileError> =>
  Effect.gen(function* () {
    if (!profile.ios) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no ios section.`,
      });
    }
    if (!appMeta.bundleId) {
      return yield* new BuildProfileError({
        message: "Missing ios.bundleIdentifier in your Expo config.",
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

const resolveAndroidTarget = (
  profile: Effect.Effect.Success<ReturnType<typeof readBuildProfile>>,
  appMeta: Effect.Effect.Success<ReturnType<typeof readAppMeta>>,
  projectRoot: string,
) =>
  Effect.gen(function* () {
    if (!profile.android) {
      return yield* new BuildProfileError({
        message: `Profile "${profile.name}" has no android section.`,
      });
    }
    if (!appMeta.androidPackage) {
      return yield* new BuildProfileError({
        message: "Missing android.package in your Expo config.",
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
      yield* new ArtifactNotFoundError({
        message: `Artifact not found at ${options.artifactPath}.`,
      });
    }

    const baseConfig = yield* readExpoConfig(projectRoot);
    const projectId = yield* extractProjectId(baseConfig);
    const profile = yield* readBuildProfile(baseConfig, options.profileName);

    const envVars = yield* pullEnvVars(api, {
      projectId,
      environment: profile.environment,
    });

    const expoConfig = yield* readExpoConfig(projectRoot, envVars);
    const appMeta = yield* readAppMeta(expoConfig, options.platform);

    const runtimeVersion = yield* resolveRuntimeVersion({
      raw: appMeta.rawRuntimeVersion,
      appVersion: appMeta.appVersion,
      projectRoot,
    });

    const { target, bundleId } =
      options.platform === "ios"
        ? yield* resolveIosTarget(profile, appMeta)
        : yield* resolveAndroidTarget(profile, appMeta, projectRoot);

    yield* Console.log(`Hashing ${options.artifactPath}...`);
    const { sha256, byteSize } = yield* sha256File(options.artifactPath);

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
      artifactPath: options.artifactPath,
      sha256,
      byteSize,
    });

    yield* Console.log("");
    yield* printKeyValue([
      ["Build ID", result.id],
      ["Status", result.status],
      ["Platform", options.platform],
      ["Profile", profile.name],
      ["Runtime version", runtimeVersion],
      ["Artifact", options.artifactPath],
      ["SHA-256", sha256],
      ["Bytes", String(byteSize)],
    ]);
  });
