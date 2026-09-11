import path from "node:path";

import { compact } from "@better-update/type-guards";
import { FileSystem, Effect } from "effect";

import { renderSigningGradle } from "../../lib/android-signing-gradle";
import { applyAndroidVersion } from "../../lib/android-version-sync";
import { findAndroidArtifact, findArtifactByGlob } from "../../lib/artifact-finder";
import { runBuildHook } from "../../lib/build-hooks";
import {
  BUNDLETOOL_MISSING_HINT,
  buildUniversalApk,
  resolveBundletool,
} from "../../lib/bundletool";
import { downloadAndroidCredentials } from "../../lib/credentials-downloader";
import { collectAndroidDebugArtifacts } from "../../lib/debug-artifacts";
import { BuildFailedError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";
import { loadLocalAndroidCredentials } from "../../lib/local-credentials";
import { sha256File } from "../../lib/sha256";
import { capitalize } from "../../lib/string-utils";
import { setAndroidUpdateChannel } from "../../lib/update-channel-native";
import { printWarn } from "../../lib/warning-style";
import { CliRuntime } from "../../services/cli-runtime";
import { runStep } from "./run-step";

import type { AndroidProfile, CredentialsSource } from "../../lib/build-profile";
import type { AndroidBuildStrategy } from "../../lib/build-strategy";
import type { CapturedDebugArtifact } from "../../lib/debug-artifacts";
import type { CustomCommandSpec } from "../../lib/eas-config";
import type { PackageManager } from "../../lib/project-staging";
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
  /** Package manager of the staged workspace — used to run lifecycle hooks. */
  readonly packageManager: PackageManager;
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
  /**
   * Version values to materialize into build.gradle / `.env` before the Gradle
   * build. Set by non-Expo callers when eas.json carries an explicit version /
   * versionCode override; undefined leaves the native version as-is.
   */
  readonly nativeVersion?:
    | { readonly versionName?: string; readonly versionCode?: string }
    | undefined;
}

interface AndroidSigningCredentials {
  readonly keystorePath: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
}

/**
 * The universal APK produced next to an `.aab` so the build can be installed
 * on a device (Play takes the bundle; a phone will not). Same signing key as
 * the bundle. Absent for `apk` builds, for `universalApk: false` profiles, and
 * when the fallback converter is unavailable.
 */
export interface AndroidInstallArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly byteSize: number;
}

const wantsUniversalApk = (profile: AndroidProfile): boolean =>
  profile.format === "aab" && profile.universalApk !== false;

/**
 * bundletool fallback for builds where Gradle could not assemble the APK
 * itself (custom commands, explicit `gradleTask`). Best-effort: a missing
 * bundletool or a conversion failure warns and leaves the bundle without a
 * companion — the `.aab` is still the deliverable.
 */
const deriveUniversalApkWithBundletool = (params: {
  readonly aabPath: string;
  readonly tempDir: string;
  readonly credentials: AndroidSigningCredentials | undefined;
}) =>
  Effect.gen(function* () {
    const tool = yield* resolveBundletool;
    if (tool === null) {
      yield* printWarn(`Universal APK skipped: ${BUNDLETOOL_MISSING_HINT}`);
      return undefined;
    }
    const apkPath = yield* buildUniversalApk(tool, {
      aabPath: params.aabPath,
      workDir: params.tempDir,
      signing: params.credentials,
    });
    const { sha256, byteSize } = yield* sha256File(apkPath);
    return { path: apkPath, sha256, byteSize } satisfies AndroidInstallArtifact;
  }).pipe(
    Effect.catch((error) =>
      printWarn(`Universal APK skipped: ${formatCause(error)}`).pipe(
        Effect.as<AndroidInstallArtifact | undefined>(undefined),
      ),
    ),
  );

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
  Effect.Error<ReturnType<typeof downloadAndroidCredentials>>,
  Effect.Services<ReturnType<typeof downloadAndroidCredentials>>
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

/**
 * Repair the staged `gradlew` before running it: re-assert the executable bit
 * (copy/checkout can drop it) and, for committed native dirs (bare/KMP/native),
 * normalize Windows CRLF line endings that break the shell wrapper. Mirrors
 * EAS's FIX_GRADLEW phase. Best-effort — a failure here surfaces as the real
 * gradlew error instead.
 */
const fixGradlew = (androidDir: string, fixLineEndings: boolean) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const gradlewPath = path.join(androidDir, "gradlew");
    const exists = yield* fs.exists(gradlewPath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return;
    }
    if (fixLineEndings) {
      const content = yield* fs.readFileString(gradlewPath).pipe(Effect.orElseSucceed(() => ""));
      if (content.includes("\r\n")) {
        yield* fs
          .writeFileString(gradlewPath, content.replaceAll("\r\n", "\n"))
          .pipe(Effect.orElseSucceed(() => undefined));
      }
    }
    yield* fs.chmod(gradlewPath, 0o755).pipe(Effect.orElseSucceed(() => undefined));
  });

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

    yield* fixGradlew(androidDir, input.strategy !== "expo");

    // Materialize the eas.json version override into the committed native sources
    // (Expo regenerates android/ via prebuild, so the caller leaves this unset there).
    if (input.nativeVersion !== undefined) {
      yield* applyAndroidVersion({
        projectRoot: input.projectRoot,
        ...compact({
          versionName: input.nativeVersion.versionName,
          versionCode: input.nativeVersion.versionCode,
        }),
      });
    }

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

    const explicitTask = input.androidProfile.gradleTask;
    const taskName = explicitTask ?? gradleTaskName(format, flavor, buildType);
    const toTaskArg = (task: string) => (task.startsWith(":") ? task : `:${moduleName}:${task}`);
    // An `.aab` build assembles the universal APK in the SAME Gradle
    // invocation: `bundleRelease assembleRelease` share every compile/dex/
    // resource task, so the APK costs one packaging step, not a second build.
    // An explicit `gradleTask` has no derivable assemble twin — that case
    // falls back to bundletool after the build.
    const universalApkViaGradle =
      wantsUniversalApk(input.androidProfile) && explicitTask === undefined;
    const taskArgs = [
      toTaskArg(taskName),
      ...(universalApkViaGradle ? [toTaskArg(gradleTaskName("apk", flavor, buildType))] : []),
    ];
    yield* runStep(
      {
        command: "./gradlew",
        args: [...gradleArgs, ...taskArgs, "--profile"],
        cwd: androidDir,
        // Gradle needs a UTF-8 locale for tool output — same value EAS sets.
        env: { ...commandEnv, LC_ALL: "C.UTF-8" },
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
    const installArtifact = yield* resolveGradleInstallArtifact({
      input,
      viaGradle: universalApkViaGradle,
      aabPath: artifactPath,
      buildType,
      buildStartMs,
      moduleName,
      credentials,
    });
    // Best-effort: R8 mapping, RN sourcemap and NDK symbols only exist for
    // some configurations — a capture failure never fails the build.
    const debugArtifacts = yield* collectAndroidDebugArtifacts({
      projectRoot: input.projectRoot,
      module: moduleName,
      minMtimeMs: buildStartMs,
    }).pipe(
      Effect.catch((error) =>
        printWarn(`Debug symbol capture skipped: ${formatCause(error)}`).pipe(
          Effect.as([] as readonly CapturedDebugArtifact[]),
        ),
      ),
    );
    return { artifactPath, byteSize, sha256, debugArtifacts, installArtifact };
  });

/** Which universal-APK path applies after a Gradle build, if any. */
const resolveGradleInstallArtifact = (params: {
  readonly input: RunAndroidBuildInput;
  readonly viaGradle: boolean;
  readonly aabPath: string;
  readonly buildType: "debug" | "release";
  readonly buildStartMs: number;
  readonly moduleName: string;
  readonly credentials: AndroidSigningCredentials | undefined;
}) => {
  if (params.viaGradle) {
    return findGradleUniversalApk({
      projectRoot: params.input.projectRoot,
      buildType: params.buildType,
      minMtimeMs: params.buildStartMs,
      module: params.moduleName,
      flavor: params.input.androidProfile.flavor,
    });
  }
  if (wantsUniversalApk(params.input.androidProfile)) {
    return deriveUniversalApkWithBundletool({
      aabPath: params.aabPath,
      tempDir: params.input.tempDir,
      credentials: params.credentials,
    });
  }
  // @effect-diagnostics-next-line effect/effectSucceedWithVoid:off -- undefined is a load-bearing success value (AndroidInstallArtifact | undefined); Effect.void breaks the declared return type
  return Effect.succeed(undefined);
};

/**
 * The APK that `assemble<Variant>` wrote next to the bundle. Gradle already
 * succeeded, so a missing file means an unusual output layout — warn rather
 * than fail a build whose `.aab` is in hand.
 */
const findGradleUniversalApk = (params: {
  readonly projectRoot: string;
  readonly buildType: "debug" | "release";
  readonly minMtimeMs: number;
  readonly module: string;
  readonly flavor: string | undefined;
}) =>
  Effect.gen(function* () {
    const apkPath = yield* findAndroidArtifact({
      projectRoot: params.projectRoot,
      format: "apk",
      buildType: params.buildType,
      minMtimeMs: params.minMtimeMs,
      module: params.module,
      ...compact({ flavor: params.flavor }),
    });
    const { sha256, byteSize } = yield* sha256File(apkPath);
    return { path: apkPath, sha256, byteSize } satisfies AndroidInstallArtifact;
  }).pipe(
    Effect.catch((error) =>
      printWarn(`Universal APK skipped: ${formatCause(error)}`).pipe(
        Effect.as<AndroidInstallArtifact | undefined>(undefined),
      ),
    ),
  );

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
    // The command owns its Gradle invocation, so the APK cannot ride along —
    // convert the bundle it produced instead.
    const installArtifact = wantsUniversalApk(input.androidProfile)
      ? yield* deriveUniversalApkWithBundletool({
          aabPath: artifactPath,
          tempDir: input.tempDir,
          credentials,
        })
      : undefined;
    return {
      artifactPath,
      byteSize,
      sha256,
      debugArtifacts: [] as readonly CapturedDebugArtifact[],
      installArtifact,
    };
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
    }

    // Bake the OTA channel AFTER prebuild (which regenerates `android/`) and
    // BEFORE any build step — for EVERY strategy, not just "expo". A committed
    // AndroidManifest.xml is just as valid an injection target as a generated
    // one, and a custom command reads that same file. This used to live inside
    // the branch above, so bare/native/kmp/custom builds shipped with no
    // channel at all and silently fell back to the server's default channel.
    // Anchored on a custom block's `cwd` so a sub-project build injects into
    // the tree it actually builds, and on the profile's Gradle module so a
    // project assembling `:mobile` is not written into a stale `:app`.
    //
    // A custom command that regenerates the manifest itself (`expo prebuild`,
    // a codegen step) will overwrite this — it owns its pipeline, so it also
    // owns the channel from that point on. Nothing can be done from here.
    if (input.updateChannel !== undefined) {
      const customCwd = input.strategy === "custom" ? input.customCommand?.cwd : undefined;
      yield* setAndroidUpdateChannel({
        projectRoot:
          customCwd === undefined ? input.projectRoot : path.join(input.projectRoot, customCwd),
        channel: input.updateChannel,
        module: input.androidProfile.module,
      });
    }

    // Custom commands own their full pipeline; the managed strategies run the
    // post-install lifecycle hook after deps + prebuild are in place (EAS parity).
    if (input.strategy !== "custom") {
      yield* runBuildHook({
        name: "eas-build-post-install",
        projectRoot: input.projectRoot,
        packageManager: input.packageManager,
        env: commandEnv,
      });
    }

    return input.strategy === "custom"
      ? yield* runAndroidCustom(input, commandEnv)
      : yield* runGradleBuild(input, commandEnv);
  });
