import path from "node:path";
import process from "node:process";

import { FileSystem, Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

import type { PlatformError } from "effect/PlatformError";
import type { ChildProcessSpawner } from "effect/unstable/process";

import { runExitCode, runText } from "./child-process";
import { BuildFailedError } from "./exit-codes";

/**
 * Google's bundletool, the reference `.aab` → `.apk` converter. Not shipped
 * with the Android SDK: users install the Homebrew launcher (`bundletool` on
 * PATH) or drop the release jar somewhere and point `BUNDLETOOL_JAR` at it.
 * The Gradle strategies never need it — they assemble the universal APK in the
 * same Gradle run — so this is only the fallback for custom-command builds and
 * profiles that pin an explicit `gradleTask`.
 */
export interface BundletoolCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface BundletoolSigning {
  readonly keystorePath: string;
  readonly storePassword: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
}

export interface UniversalApkInput {
  readonly aabPath: string;
  /** Scratch directory for the `.apks` set, password files and the extracted APK. */
  readonly workDir: string;
  /** Omitted → bundletool signs with its own debug key (fine for `withoutCredentials`). */
  readonly signing?: BundletoolSigning | undefined;
}

const locateOnPath = (bin: string) =>
  runText(ChildProcess.make("which", [bin])).pipe(
    Effect.map((output) => output.trim()),
    Effect.map((located) => (located === "" ? null : located)),
    Effect.orElseSucceed((): string | null => null),
  );

/**
 * `BUNDLETOOL_JAR` wins (explicit beats discovered), then a `bundletool`
 * launcher on PATH. `null` when neither is available — callers degrade to
 * "no universal APK" with a hint rather than failing the build.
 */
export const resolveBundletool: Effect.Effect<
  BundletoolCommand | null,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> = Effect.gen(function* () {
  const jar = process.env["BUNDLETOOL_JAR"];
  if (jar !== undefined && jar !== "") {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(jar).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      return { command: "java", args: ["-jar", jar] };
    }
  }
  const launcher = yield* locateOnPath("bundletool");
  return launcher === null ? null : { command: launcher, args: [] };
});

export const BUNDLETOOL_MISSING_HINT =
  "bundletool not found — install it (`brew install bundletool`) or set BUNDLETOOL_JAR to the release jar.";

/**
 * Arguments for `bundletool build-apks --mode=universal`. Passwords travel via
 * `file:` references, never on the command line (visible to every process on
 * the machine through `ps`). Pure — the caller writes the password files.
 */
export const universalApkArgs = (params: {
  readonly aabPath: string;
  readonly apksPath: string;
  readonly signing:
    | {
        readonly keystorePath: string;
        readonly keyAlias: string;
        readonly storePassFile: string;
        readonly keyPassFile: string;
      }
    | undefined;
}): readonly string[] => [
  "build-apks",
  `--bundle=${params.aabPath}`,
  `--output=${params.apksPath}`,
  "--mode=universal",
  "--overwrite",
  ...(params.signing === undefined
    ? []
    : [
        `--ks=${params.signing.keystorePath}`,
        `--ks-pass=file:${params.signing.storePassFile}`,
        `--ks-key-alias=${params.signing.keyAlias}`,
        `--key-pass=file:${params.signing.keyPassFile}`,
      ]),
];

const failWith =
  (message: string) =>
  (cause: unknown): BuildFailedError =>
    new BuildFailedError({
      step: "bundletool",
      exitCode: 1,
      message: `${message}: ${String(cause)}`,
    });

const writeSecretFile = (filePath: string, value: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(filePath, value);
    yield* fs.chmod(filePath, 0o600);
    return filePath;
  }).pipe(Effect.mapError(failWith("Failed to stage keystore password")));

const runBundletool = (tool: BundletoolCommand, args: readonly string[]) =>
  runExitCode(
    ChildProcess.make(tool.command, [...tool.args, ...args], {
      stdout: "inherit",
      stderr: "inherit",
    }),
  ).pipe(
    Effect.mapError(failWith("bundletool failed to spawn")),
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new BuildFailedError({
              step: "bundletool",
              exitCode: code,
              message: `bundletool build-apks exited with code ${String(code)}`,
            }),
          ),
    ),
  );

/**
 * Build the universal APK of an App Bundle: one `.apks` set in universal mode,
 * then `universal.apk` lifted out of it (the set is a plain zip). Returns the
 * extracted APK path.
 */
export const buildUniversalApk = (
  tool: BundletoolCommand,
  input: UniversalApkInput,
): Effect.Effect<
  string,
  BuildFailedError | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const workDir = path.join(input.workDir, "universal-apk");
    yield* fs.makeDirectory(workDir, { recursive: true });
    const apksPath = path.join(workDir, "universal.apks");

    const signing =
      input.signing === undefined
        ? undefined
        : {
            keystorePath: input.signing.keystorePath,
            keyAlias: input.signing.keyAlias,
            storePassFile: yield* writeSecretFile(
              path.join(workDir, "ks-pass"),
              input.signing.storePassword,
            ),
            keyPassFile: yield* writeSecretFile(
              path.join(workDir, "key-pass"),
              input.signing.keyPassword,
            ),
          };

    yield* runBundletool(tool, universalApkArgs({ aabPath: input.aabPath, apksPath, signing }));

    // `unzip -j` drops the archive path so the APK lands directly in workDir.
    const code = yield* runExitCode(
      ChildProcess.make("unzip", ["-q", "-o", "-j", apksPath, "universal.apk", "-d", workDir]),
    ).pipe(Effect.mapError(failWith("unzip failed to spawn")));
    if (code !== 0) {
      return yield* new BuildFailedError({
        step: "bundletool",
        exitCode: code,
        message: `Could not extract universal.apk from ${apksPath} (unzip exited with ${String(code)})`,
      });
    }
    return path.join(workDir, "universal.apk");
  });
