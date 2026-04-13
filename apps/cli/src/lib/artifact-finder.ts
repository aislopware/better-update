import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";

import type { PlatformError } from "@effect/platform/Error";

import { ArtifactNotFoundError } from "./exit-codes";
import { capitalize } from "./string-utils";

export interface FindIosArtifactOptions {
  readonly exportPath: string;
}

export interface FindAndroidArtifactOptions {
  readonly projectRoot: string;
  readonly format: "apk" | "aab";
  readonly flavor?: string;
  readonly buildType: "debug" | "release";
  /**
   * If provided, only artifacts with mtimeMs >= this value are considered.
   * Used to exclude stale artifacts from previous builds when the current
   * build failed to write an expected output.
   */
  readonly minMtimeMs?: number;
}

interface FoundFile {
  readonly path: string;
  readonly mtimeMs: number;
}

const walkAndFind = (
  root: string,
  extension: string,
): Effect.Effect<ReadonlyArray<FoundFile>, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // No fs.exists pre-check: readDirectory on a missing/non-dir path fails
    // with a PlatformError that we catch into an empty list below.
    const entries = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));

    const results: Array<FoundFile> = [];
    for (const entry of entries) {
      const fullPath = path.join(root, entry);
      const stat = yield* fs.stat(fullPath).pipe(Effect.option);
      if (Option.isNone(stat)) continue;
      const info = stat.value;
      if (info.type === "Directory") {
        const nested = yield* walkAndFind(fullPath, extension);
        for (const n of nested) results.push(n);
      } else if (info.type === "File" && entry.toLowerCase().endsWith(extension)) {
        results.push({
          path: fullPath,
          mtimeMs: Option.match(info.mtime, {
            onNone: () => 0,
            onSome: (d) => d.getTime(),
          }),
        });
      }
    }
    return results;
  });

const newest = (files: ReadonlyArray<FoundFile>, minMtimeMs?: number): FoundFile | undefined => {
  const eligible = minMtimeMs === undefined ? files : files.filter((f) => f.mtimeMs >= minMtimeMs);
  if (eligible.length === 0) return undefined;
  return eligible.reduce((acc, cur) => (cur.mtimeMs > acc.mtimeMs ? cur : acc));
};

export const findIosArtifact = ({
  exportPath,
}: FindIosArtifactOptions): Effect.Effect<
  string,
  ArtifactNotFoundError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const files = yield* walkAndFind(exportPath, ".ipa");
    const picked = newest(files);
    if (!picked) {
      return yield* new ArtifactNotFoundError({
        message: `No .ipa file found under "${exportPath}".`,
      });
    }
    return picked.path;
  });

export const findAndroidArtifact = ({
  projectRoot,
  format,
  flavor,
  buildType,
  minMtimeMs,
}: FindAndroidArtifactOptions): Effect.Effect<
  string,
  ArtifactNotFoundError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const outputsRoot = path.join(projectRoot, "android", "app", "build", "outputs");
    const subdir = format === "aab" ? "bundle" : "apk";
    const variantDir = (flavor ? flavor : "") + (flavor ? capitalize(buildType) : buildType);
    const expectedDir = path.join(outputsRoot, subdir, variantDir);

    const direct = yield* walkAndFind(expectedDir, `.${format}`);
    const pickedDirect = newest(direct, minMtimeMs);
    if (pickedDirect) return pickedDirect.path;

    const fallback = yield* walkAndFind(outputsRoot, `.${format}`);
    const pickedFallback = newest(fallback, minMtimeMs);
    if (!pickedFallback) {
      return yield* new ArtifactNotFoundError({
        message: `No .${format} artifact found under "${outputsRoot}"${minMtimeMs !== undefined ? " (newer than build start)" : ""}.`,
      });
    }
    return pickedFallback.path;
  });
