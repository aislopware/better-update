import path from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { renderSigningGradle } from "../../lib/android-signing-gradle";
import { findAndroidArtifact } from "../../lib/artifact-finder";
import { downloadAndroidCredentials } from "../../lib/credentials-downloader";
import { sha256File } from "../../lib/sha256";
import { capitalize } from "../../lib/string-utils";
import { CliRuntime } from "../../services/cli-runtime";
import { runStep } from "./run-step";

import type { AndroidProfile } from "../../lib/build-profile";
import type {
  ArtifactNotFoundError,
  BuildFailedError,
  MissingCredentialsError,
} from "../../lib/exit-codes";
import type { ApiClient } from "../../services/api-client";

export interface RunAndroidBuildInput {
  readonly api: ApiClient;
  readonly tempDir: string;
  readonly projectRoot: string;
  readonly androidProfile: AndroidProfile;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
}

export interface RunAndroidBuildResult {
  readonly artifactPath: string;
  readonly byteSize: number;
  readonly sha256: string;
}

/**
 * Compose the Gradle task name from flavor, format, and buildType.
 *
 * Gradle naming convention: `<verb><Flavor><Variant>`, e.g.
 *   - no flavor + apk + release       → `assembleRelease`
 *   - no flavor + aab + release       → `bundleRelease`
 *   - flavor=prod + aab + release     → `bundleProdRelease`
 *   - flavor=prod + apk + debug       → `assembleProdDebug`
 */
const gradleTaskName = (
  format: "apk" | "aab",
  flavor: string | undefined,
  buildType: "debug" | "release",
): string => {
  const verb = format === "aab" ? "bundle" : "assemble";
  return flavor
    ? `${verb}${capitalize(flavor)}${capitalize(buildType)}`
    : `${verb}${capitalize(buildType)}`;
};

export const runAndroidBuild = (
  input: RunAndroidBuildInput,
): Effect.Effect<
  RunAndroidBuildResult,
  BuildFailedError | MissingCredentialsError | ArtifactNotFoundError | PlatformError,
  CliRuntime | CommandExecutor.CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const { api, tempDir, projectRoot, androidProfile, envVars, projectId } = input;
    const runtime = yield* CliRuntime;

    // Record build start so artifact-finder can reject stale outputs from
    // earlier builds that may still live in `android/app/build/outputs/`.
    const buildStartMs = Date.now();

    const format = androidProfile.format;
    const flavor = androidProfile.flavor;
    const buildType = androidProfile.buildType ?? "release";
    const androidDir = path.join(projectRoot, "android");
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    const credentials = yield* downloadAndroidCredentials(api, {
      projectId,
      tempDir,
    });

    yield* runStep(
      Command.make("bunx", "expo", "prebuild", "--platform", "android", "--clean").pipe(
        Command.workingDirectory(projectRoot),
        Command.env(commandEnv),
      ),
      "expo prebuild android",
    );

    const fs = yield* FileSystem.FileSystem;
    const signingGradlePath = path.join(tempDir, "signing.gradle");
    yield* fs.writeFileString(
      signingGradlePath,
      renderSigningGradle({
        keystorePath: credentials.keystorePath,
        storePassword: credentials.storePassword,
        keyAlias: credentials.keyAlias,
        keyPassword: credentials.keyPassword,
      }),
    );

    const taskName = gradleTaskName(format, flavor, buildType);
    yield* runStep(
      Command.make("./gradlew", "--init-script", signingGradlePath, `:app:${taskName}`).pipe(
        Command.workingDirectory(androidDir),
        Command.env(commandEnv),
      ),
      "gradlew",
    );

    const artifactPath = yield* findAndroidArtifact({
      projectRoot,
      format,
      ...(flavor !== undefined ? { flavor } : {}),
      buildType,
      minMtimeMs: buildStartMs,
    });

    const { sha256, byteSize } = yield* sha256File(artifactPath);

    return { artifactPath, byteSize, sha256 };
  });
