import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";

import { renderSigningGradle } from "../../lib/android-signing-gradle";
import { findAndroidArtifact } from "../../lib/artifact-finder";
import { downloadAndroidCredentials } from "../../lib/credentials-downloader";
import { loadLocalAndroidCredentials } from "../../lib/local-credentials";
import { sha256File } from "../../lib/sha256";
import { capitalize } from "../../lib/string-utils";
import { CliRuntime } from "../../services/cli-runtime";
import { runStep } from "./run-step";

import type { AndroidProfile, CredentialsSource } from "../../lib/build-profile";
import type {
  ArtifactNotFoundError,
  BuildFailedError,
  MissingCredentialsError,
} from "../../lib/exit-codes";
import type { InteractiveMode } from "../../lib/interactive-mode";
import type { ApiClient } from "../../services/api-client";
import type { IdentityStore } from "../../services/identity-store";

export interface RunAndroidBuildInput {
  readonly api: ApiClient;
  readonly tempDir: string;
  readonly projectRoot: string;
  readonly androidProfile: AndroidProfile;
  readonly applicationIdentifier: string;
  readonly envVars: Record<string, string>;
  readonly projectId: string;
  readonly credentialsSource: CredentialsSource;
  readonly profileName: string;
  /**
   * When true, skip remote keystore fetch and Gradle signing init-script. The
   * Android project's native debug signingConfig (RN template debug.keystore)
   * signs the artifact. Set by callers for `developmentClient: true` or
   * `withoutCredentials: true` profiles (mirrors EAS withoutCredentials).
   */
  readonly skipCredentials: boolean;
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
  | CliRuntime
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | IdentityStore
  | InteractiveMode
> =>
  Effect.gen(function* () {
    const { api, tempDir, projectRoot, androidProfile, applicationIdentifier, envVars, projectId } =
      input;
    const runtime = yield* CliRuntime;

    // Record build start so artifact-finder can reject stale outputs from
    // Earlier builds that may still live in `android/app/build/outputs/`.
    const buildStartMs = Date.now();

    const { format } = androidProfile;
    const { flavor } = androidProfile;
    const buildType = androidProfile.buildType ?? "release";
    const androidDir = path.join(projectRoot, "android");
    const commandEnv = yield* runtime.commandEnvironment(envVars);

    yield* runStep(
      {
        command: "bunx",
        args: ["expo", "prebuild", "--platform", "android", "--clean"],
        cwd: projectRoot,
        env: commandEnv,
      },
      "expo prebuild android",
    );

    // For dev / withoutCredentials builds, the Android project's own debug
    // signingConfig (RN template debug.keystore) signs the APK. The init-script
    // only overrides the `release` variant, so skipping it is the same as
    // injecting it when running assembleDebug — but skipping also lets the
    // build proceed without a server-side keystore registered for the project.
    const gradleArgs = yield* input.skipCredentials
      ? Effect.succeed<readonly string[]>([])
      : Effect.gen(function* () {
          const credentials =
            input.credentialsSource === "local"
              ? yield* loadLocalAndroidCredentials({ projectRoot })
              : yield* downloadAndroidCredentials(api, {
                  projectId,
                  applicationIdentifier,
                  tempDir,
                  buildProfile: input.profileName,
                });
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
          return ["--init-script", signingGradlePath] as const;
        });

    const taskName = gradleTaskName(format, flavor, buildType);
    yield* runStep(
      {
        command: "./gradlew",
        args: [...gradleArgs, `:app:${taskName}`],
        cwd: androidDir,
        env: commandEnv,
      },
      "gradlew",
    );

    const artifactPath = yield* findAndroidArtifact({
      projectRoot,
      format,
      buildType,
      minMtimeMs: buildStartMs,
      ...compact({ flavor }),
    });

    const { sha256, byteSize } = yield* sha256File(artifactPath);

    return { artifactPath, byteSize, sha256 };
  });
