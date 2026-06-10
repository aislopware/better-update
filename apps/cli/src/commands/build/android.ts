import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { renderSigningGradle } from "../../lib/android-signing-gradle";
import { findAndroidArtifact, findArtifactByGlob } from "../../lib/artifact-finder";
import { downloadAndroidCredentials } from "../../lib/credentials-downloader";
import { BuildFailedError } from "../../lib/exit-codes";
import { loadLocalAndroidCredentials } from "../../lib/local-credentials";
import { sha256File } from "../../lib/sha256";
import { capitalize } from "../../lib/string-utils";
import { setAndroidUpdateChannel } from "../../lib/update-channel-native";
import { CliRuntime } from "../../services/cli-runtime";
import { runStep } from "./run-step";

import type { AndroidProfile, CredentialsSource } from "../../lib/build-profile";
import type { AndroidBuildStrategy } from "../../lib/build-strategy";
import type { CustomCommandSpec } from "../../lib/eas-config";
import type { ApiClient } from "../../services/api-client";

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
  /** How to produce the artifact (prebuild+gradle / gradle / custom-command). */
  readonly strategy: AndroidBuildStrategy;
  /** Custom build command, required when `strategy === "custom"`. */
  readonly customCommand?: CustomCommandSpec;
  /**
   * When true, skip remote keystore fetch and Gradle signing init-script. The
   * Android project's native debug signingConfig (RN template debug.keystore)
   * signs the artifact. Set by callers for `developmentClient: true` or
   * `withoutCredentials: true` profiles (mirrors EAS withoutCredentials).
   */
  readonly skipCredentials: boolean;
  /** OTA channel baked into the manifest after prebuild; undefined skips injection. */
  readonly updateChannel?: string | undefined;
}

interface AndroidSigningCredentials {
  readonly keystorePath: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
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

/** Resolve the signing keystore (remote or local), or `undefined` when skipped. */
const resolveAndroidCredentials = (
  input: RunAndroidBuildInput,
): Effect.Effect<
  AndroidSigningCredentials | undefined,
  Effect.Effect.Error<ReturnType<typeof downloadAndroidCredentials>>,
  Effect.Effect.Context<ReturnType<typeof downloadAndroidCredentials>>
> => {
  if (input.skipCredentials) {
    // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (AndroidSigningCredentials | undefined); Effect.void breaks the declared return type
    return Effect.succeed(undefined);
  }
  return input.credentialsSource === "local"
    ? loadLocalAndroidCredentials({ projectRoot: input.projectRoot })
    : downloadAndroidCredentials(input.api, {
        projectId: input.projectId,
        applicationIdentifier: input.applicationIdentifier,
        tempDir: input.tempDir,
        buildProfile: input.profileName,
      });
};

/** Gradle build against the (already-prepared) `android/` dir. */
const runGradleBuild = (input: RunAndroidBuildInput, commandEnv: Record<string, string>) =>
  Effect.gen(function* () {
    // Record build start so artifact-finder can reject stale outputs from
    // earlier builds that may still live in `android/.../build/outputs/`.
    const buildStartMs = Date.now();

    const { format, flavor } = input.androidProfile;
    const buildType = input.androidProfile.buildType ?? "release";
    const moduleName = input.androidProfile.module ?? "app";
    const androidDir = path.join(input.projectRoot, "android");

    const credentials = yield* resolveAndroidCredentials(input);
    const gradleArgs: readonly string[] =
      credentials === undefined
        ? []
        : yield* Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const signingGradlePath = path.join(input.tempDir, "signing.gradle");
            yield* fs.writeFileString(signingGradlePath, renderSigningGradle(credentials));
            return ["--init-script", signingGradlePath];
          });

    const taskName = input.androidProfile.gradleTask ?? gradleTaskName(format, flavor, buildType);
    const taskArg = taskName.startsWith(":") ? taskName : `:${moduleName}:${taskName}`;
    yield* runStep(
      {
        command: "./gradlew",
        args: [...gradleArgs, taskArg],
        cwd: androidDir,
        env: commandEnv,
      },
      "gradlew",
    );

    const artifactPath = yield* findAndroidArtifact({
      projectRoot: input.projectRoot,
      format,
      buildType,
      minMtimeMs: buildStartMs,
      module: moduleName,
      ...compact({ flavor }),
    });

    const { sha256, byteSize } = yield* sha256File(artifactPath);
    return { artifactPath, byteSize, sha256 };
  });

/**
 * Custom-command build. We can't inject signing into an arbitrary build, so the
 * resolved keystore + passwords are exposed to the command as `BETTER_UPDATE_*`
 * env vars; the user's script consumes them. The artifact is located via the
 * profile's `artifactPath` glob.
 */
const runAndroidCustom = (input: RunAndroidBuildInput, commandEnv: Record<string, string>) =>
  Effect.gen(function* () {
    const buildStartMs = Date.now();
    const custom = input.customCommand;
    if (custom === undefined) {
      return yield* new BuildFailedError({
        step: "custom android build",
        exitCode: 1,
        message: "Internal: custom Android strategy selected without a custom command.",
      });
    }
    if (custom.artifactPath === undefined) {
      return yield* new BuildFailedError({
        step: "custom android build",
        exitCode: 1,
        message: 'Custom Android build requires "artifactPath" (e.g. "**/*.aab") in eas.json.',
      });
    }

    const credentials = yield* resolveAndroidCredentials(input);
    const credEnv =
      credentials === undefined
        ? {}
        : {
            BETTER_UPDATE_ANDROID_KEYSTORE_PATH: credentials.keystorePath,
            BETTER_UPDATE_ANDROID_KEYSTORE_PASSWORD: credentials.storePassword,
            BETTER_UPDATE_ANDROID_KEY_ALIAS: credentials.keyAlias,
            BETTER_UPDATE_ANDROID_KEY_PASSWORD: credentials.keyPassword,
          };
    const cwd =
      custom.cwd === undefined ? input.projectRoot : path.join(input.projectRoot, custom.cwd);

    yield* runStep(
      {
        command: "sh",
        args: ["-c", custom.command],
        cwd,
        env: { ...commandEnv, ...credEnv, ...custom.env },
      },
      "custom android build",
    );

    const artifactPath = yield* findArtifactByGlob({
      baseDir: cwd,
      pattern: custom.artifactPath,
      minMtimeMs: buildStartMs,
    });
    const { sha256, byteSize } = yield* sha256File(artifactPath);
    return { artifactPath, byteSize, sha256 };
  });

export const runAndroidBuild = (input: RunAndroidBuildInput) =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const commandEnv = yield* runtime.commandEnvironment(input.envVars);

    // Expo regenerates `android/` from app.json before building; bare/KMP/native
    // build the committed `android/` as-is.
    if (input.strategy === "expo") {
      yield* runStep(
        {
          command: "bunx",
          args: ["expo", "prebuild", "--platform", "android", "--clean"],
          cwd: input.projectRoot,
          env: commandEnv,
        },
        "expo prebuild android",
      );
      if (input.updateChannel !== undefined) {
        yield* setAndroidUpdateChannel({
          projectRoot: input.projectRoot,
          channel: input.updateChannel,
        });
      }
    }

    return input.strategy === "custom"
      ? yield* runAndroidCustom(input, commandEnv)
      : yield* runGradleBuild(input, commandEnv);
  });
