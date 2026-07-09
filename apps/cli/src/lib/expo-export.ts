import path from "node:path";

import { asRecord } from "@better-update/type-guards";
import { Command, FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { CliRuntime } from "../services/cli-runtime";
import { BuildFailedError, UpdatePublishError } from "./exit-codes";
import { printWarn } from "./warning-style";

import type { Platform } from "./build-profile";
import type { OutputMode } from "./output-mode";

export interface ExportedUpdateAssetFile {
  readonly path: string;
  readonly key: string;
  readonly fileExt: string;
  readonly contentType: string;
  readonly isLaunch: boolean;
}

interface ReadExpoPublicConfigOptions {
  readonly projectRoot: string;
  readonly envVars: Record<string, string>;
}

interface RunExpoExportOptions extends ReadExpoPublicConfigOptions {
  readonly exportDir: string;
  readonly platform: Platform;
  readonly clear: boolean;
  readonly noBytecode?: boolean;
  readonly sourceMaps?: boolean;
}

interface ReadExpoExportAssetsOptions {
  readonly exportDir: string;
  readonly platform: Platform;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const normalizeExtension = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  return value.startsWith(".") ? value.slice(1) : value;
};

const inferContentType = (fileExt: string, isLaunch: boolean): string => {
  const normalized = fileExt.toLowerCase();
  if (isLaunch || normalized === "js" || normalized === "hbc" || normalized === "bundle") {
    return "application/javascript";
  }

  switch (normalized) {
    case "png": {
      return "image/png";
    }
    case "jpg":
    case "jpeg": {
      return "image/jpeg";
    }
    case "webp": {
      return "image/webp";
    }
    case "gif": {
      return "image/gif";
    }
    case "svg": {
      return "image/svg+xml";
    }
    case "json": {
      return "application/json";
    }
    case "mp4": {
      return "video/mp4";
    }
    case "mp3": {
      return "audio/mpeg";
    }
    case "wav": {
      return "audio/wav";
    }
    case "ttf": {
      return "font/ttf";
    }
    case "otf": {
      return "font/otf";
    }
    case "woff": {
      return "font/woff";
    }
    case "woff2": {
      return "font/woff2";
    }
    default: {
      return "application/octet-stream";
    }
  }
};

const makeBunxCommand = (...args: readonly string[]): Command.Command =>
  Command.make("bunx", ...args);

const runCommand = (
  cmd: Command.Command,
  step: string,
): Effect.Effect<void, BuildFailedError, CommandExecutor.CommandExecutor> =>
  Command.exitCode(cmd.pipe(Command.stdout("inherit"), Command.stderr("inherit"))).pipe(
    Effect.mapError(
      (cause) =>
        new BuildFailedError({
          step,
          exitCode: 1,
          message: `${step} failed to spawn: ${String(cause)}`,
        }),
    ),
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(
            new BuildFailedError({
              step,
              exitCode: code,
              message: `${step} exited with code ${code}`,
            }),
          ),
    ),
  );

export const readExpoPublicConfig = ({
  projectRoot,
  envVars,
}: ReadExpoPublicConfigOptions): Effect.Effect<
  Record<string, unknown>,
  UpdatePublishError,
  CliRuntime | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const commandEnv = yield* runtime.commandEnvironment(envVars);
    const stdout = yield* Command.string(
      makeBunxCommand("expo", "config", "--type", "public", "--json").pipe(
        Command.workingDirectory(projectRoot),
        Command.env(commandEnv),
      ),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new UpdatePublishError({
            message: `Failed to read Expo public config: ${String(cause)}`,
          }),
      ),
    );

    const parsed = yield* Effect.try({
      try: () => JSON.parse(stdout) as unknown,
      catch: () =>
        new UpdatePublishError({
          message: "Expo public config output was not valid JSON.",
        }),
    });

    const config = asRecord(parsed);
    if (!config) {
      return yield* new UpdatePublishError({
        message: "Expo public config did not decode to a JSON object.",
      });
    }

    return config;
  });

export const runExpoExport = ({
  projectRoot,
  exportDir,
  platform,
  envVars,
  clear,
  noBytecode,
  sourceMaps,
}: RunExpoExportOptions): Effect.Effect<
  void,
  BuildFailedError,
  CliRuntime | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const commandEnv = yield* runtime.commandEnvironment(envVars);
    const args = [
      "expo",
      "export",
      "--platform",
      platform,
      "--output-dir",
      exportDir,
      "--dump-assetmap",
    ];
    if (clear) {
      args.push("--clear");
    }
    if (noBytecode === true) {
      args.push("--no-bytecode");
    }
    if (sourceMaps === true) {
      args.push("--source-maps");
    }

    return yield* runCommand(
      makeBunxCommand(...args).pipe(Command.workingDirectory(projectRoot), Command.env(commandEnv)),
      `expo export ${platform}`,
    );
  });

/**
 * `--source-maps` only exists on newer @expo/cli versions, so probe `expo
 * export --help` before passing the flag: sourcemap capture is best-effort by
 * contract and must degrade to a skip on older SDKs instead of failing the
 * whole publish on an unknown flag. An unreadable --help resolves to
 * "supported" (the modern common case) — a real problem then surfaces from
 * the export itself.
 */
const detectExpoExportSourceMapSupport = ({
  projectRoot,
  envVars,
}: ReadExpoPublicConfigOptions): Effect.Effect<
  boolean,
  never,
  CliRuntime | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const commandEnv = yield* runtime.commandEnvironment(envVars);
    const helpText = yield* Command.string(
      makeBunxCommand("expo", "export", "--help").pipe(
        Command.workingDirectory(projectRoot),
        Command.env(commandEnv),
      ),
    ).pipe(Effect.orElseSucceed(() => null));
    return helpText === null || helpText.includes("--source-maps");
  });

/**
 * `runExpoExport`, but with the sourcemap flag downgraded (with a warning)
 * when the project's Expo CLI does not know `--source-maps`. The publish path
 * must use this variant — `--source-maps` defaults ON there, and an older SDK
 * must lose the sourcemap, not the publish.
 */
export const runExpoExportWithSourcemapProbe = (
  options: RunExpoExportOptions,
): Effect.Effect<
  void,
  BuildFailedError,
  CliRuntime | CommandExecutor.CommandExecutor | OutputMode
> =>
  Effect.gen(function* () {
    const sourceMaps =
      options.sourceMaps === true &&
      (yield* detectExpoExportSourceMapSupport({
        projectRoot: options.projectRoot,
        envVars: options.envVars,
      }));
    if (options.sourceMaps === true && !sourceMaps) {
      yield* printWarn(
        `This project's expo export does not support --source-maps; skipping sourcemap capture for ${options.platform}.`,
      );
    }
    yield* runExpoExport({ ...options, sourceMaps });
  });

/**
 * Locate the sourcemap `expo export --source-maps` wrote for the launch
 * bundle. Metro names it after the bundle (`<bundle>.map` or the bundle path
 * with its extension swapped for `.map`), so exactly those two candidates are
 * tried — a looser "any .map in the directory" fallback could silently pick a
 * stale map from a reused export dir and poison later symbolication. Returns
 * `null` when the export produced no map (flag off, older CLI) — capture is
 * best-effort.
 */
export const findExportedSourcemap = ({
  bundlePath,
}: {
  readonly bundlePath: string;
}): Effect.Effect<string | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = (candidate: string) =>
      fs.exists(candidate).pipe(Effect.orElseSucceed(() => false));

    const appended = `${bundlePath}.map`;
    if (yield* exists(appended)) {
      return appended;
    }
    const swapped = bundlePath.replace(/\.[^./]+$/u, ".map");
    if (swapped !== bundlePath && (yield* exists(swapped))) {
      return swapped;
    }
    return null;
  });

export const readExpoExportAssets = ({
  exportDir,
  platform,
}: ReadExpoExportAssetsOptions): Effect.Effect<
  readonly ExportedUpdateAssetFile[],
  UpdatePublishError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const metadataPath = path.join(exportDir, "metadata.json");
    const metadataText = yield* fs.readFileString(metadataPath).pipe(
      Effect.mapError(
        () =>
          new UpdatePublishError({
            message: `Expected Expo export metadata at ${metadataPath}.`,
          }),
      ),
    );

    const metadata = yield* Effect.try({
      try: () => JSON.parse(metadataText) as unknown,
      catch: () =>
        new UpdatePublishError({
          message: `Failed to parse ${metadataPath} as JSON.`,
        }),
    });

    const platformMetadata = asRecord(asRecord(asRecord(metadata)?.["fileMetadata"])?.[platform]);
    const bundlePath = asString(platformMetadata?.["bundle"]);
    if (!bundlePath) {
      return yield* new UpdatePublishError({
        message: `Expo export did not contain a bundle path for platform "${platform}".`,
      });
    }

    const bundleExt = normalizeExtension(path.extname(bundlePath)) ?? "js";
    const rawAssets = Array.isArray(platformMetadata?.["assets"]) ? platformMetadata["assets"] : [];

    // eslint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach, not Array.prototype.forEach; the second arg is a mapping effect, not a thisArg
    const assets = yield* Effect.forEach(rawAssets, (rawAsset, index) =>
      Effect.gen(function* () {
        const asset = asRecord(rawAsset);
        const assetPath = asString(asset?.["path"]);
        if (!assetPath) {
          return yield* new UpdatePublishError({
            message: `Expo export asset #${String(index + 1)} is missing its "path" field.`,
          });
        }

        const fileExt =
          normalizeExtension(asString(asset?.["ext"])) ??
          normalizeExtension(path.extname(assetPath)) ??
          "bin";

        return {
          path: path.join(exportDir, assetPath),
          key: path.posix.basename(assetPath),
          fileExt,
          contentType: inferContentType(fileExt, false),
          isLaunch: false,
        } as const satisfies ExportedUpdateAssetFile;
      }),
    );

    return [
      {
        path: path.join(exportDir, bundlePath),
        key: path.posix.basename(bundlePath),
        fileExt: bundleExt,
        contentType: inferContentType(bundleExt, true),
        isLaunch: true,
      } as const satisfies ExportedUpdateAssetFile,
      ...assets,
    ] as const;
  });
