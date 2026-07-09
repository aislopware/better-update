import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect, Option } from "effect";
import { maxBy } from "es-toolkit";

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
  /** Gradle module that produced the artifact. Default "app" (RN/Expo layout). */
  readonly module?: string;
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
): Effect.Effect<readonly FoundFile[], PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    // No fs.exists pre-check: readDirectory on a missing/non-dir path fails
    // With a PlatformError that we catch into an empty list below.
    const entries = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));

    const results: FoundFile[] = [];
    for (const entry of entries) {
      const fullPath = path.join(root, entry);
      const stat = yield* fs.stat(fullPath).pipe(Effect.option);
      if (Option.isSome(stat)) {
        const info = stat.value;
        if (info.type === "Directory") {
          const nested = yield* walkAndFind(fullPath, extension);
          results.push(...nested);
        } else if (info.type === "File" && entry.toLowerCase().endsWith(extension)) {
          results.push({
            path: fullPath,
            mtimeMs: Option.match(info.mtime, {
              onNone: () => 0,
              onSome: (date) => date.getTime(),
            }),
          });
        }
      }
    }
    return results;
  });

const newest = (files: readonly FoundFile[], minMtimeMs?: number): FoundFile | undefined => {
  const eligible =
    minMtimeMs === undefined ? files : files.filter((file) => file.mtimeMs >= minMtimeMs);
  return maxBy(eligible, (file) => file.mtimeMs);
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

/**
 * Optional variant of the finders above: newest file with `extension` under
 * `root`, or `null` when nothing (recent enough) is there. Used for
 * best-effort debug-artifact capture, where a missing output is normal
 * (e.g. no ProGuard mapping when minification is off).
 */
export const findNewestFileUnder = (params: {
  readonly root: string;
  readonly extension: string;
  readonly minMtimeMs?: number;
}): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const files = yield* walkAndFind(params.root, params.extension);
    const picked = newest(files, params.minMtimeMs);
    return picked ? picked.path : null;
  });

export interface FindArtifactByGlobOptions {
  readonly baseDir: string;
  /** A literal relative path, or a simple glob like `app/build/**\/*.aab` / `build/*.ipa`. */
  readonly pattern: string;
  readonly minMtimeMs?: number;
}

/**
 * Resolve a custom-command build artifact from a user-supplied path. A pattern
 * without wildcards is treated as a literal path (relative to `baseDir`);
 * otherwise the fixed leading directory + file extension are extracted and the
 * newest matching file under that directory is returned.
 */
export const findArtifactByGlob = ({
  baseDir,
  pattern,
  minMtimeMs,
}: FindArtifactByGlobOptions): Effect.Effect<
  string,
  ArtifactNotFoundError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!/[*?[]/u.test(pattern)) {
      const full = path.isAbsolute(pattern) ? pattern : path.join(baseDir, pattern);
      const exists = yield* fs.exists(full).pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return full;
      }
      return yield* new ArtifactNotFoundError({ message: `No artifact found at "${full}".` });
    }

    const extension = path.extname(pattern).toLowerCase();
    if (extension === "") {
      return yield* new ArtifactNotFoundError({
        message: `artifactPath "${pattern}" must end in a file extension (e.g. **/*.aab).`,
      });
    }
    const wildcardIndex = pattern.search(/[*?[]/u);
    const fixedPrefix = pattern.slice(0, wildcardIndex);
    const prefixDir = fixedPrefix.includes("/")
      ? fixedPrefix.slice(0, fixedPrefix.lastIndexOf("/"))
      : "";
    const searchRoot = prefixDir === "" ? baseDir : path.join(baseDir, prefixDir);

    const files = yield* walkAndFind(searchRoot, extension);
    const picked = newest(files, minMtimeMs);
    if (!picked) {
      return yield* new ArtifactNotFoundError({
        message: `No file matching "${pattern}" found under "${searchRoot}".`,
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
  module: gradleModule = "app",
}: FindAndroidArtifactOptions): Effect.Effect<
  string,
  ArtifactNotFoundError | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const outputsRoot = path.join(projectRoot, "android", gradleModule, "build", "outputs");
    const subdir = format === "aab" ? "bundle" : "apk";
    const variantDir = flavor ? `${flavor}${capitalize(buildType)}` : buildType;
    const expectedDir = path.join(outputsRoot, subdir, variantDir);

    const direct = yield* walkAndFind(expectedDir, `.${format}`);
    const pickedDirect = newest(direct, minMtimeMs);
    if (pickedDirect) {
      return pickedDirect.path;
    }

    const fallback = yield* walkAndFind(outputsRoot, `.${format}`);
    const pickedFallback = newest(fallback, minMtimeMs);
    if (!pickedFallback) {
      return yield* new ArtifactNotFoundError({
        message: `No .${format} artifact found under "${outputsRoot}"${minMtimeMs === undefined ? "" : " (newer than build start)"}.`,
      });
    }
    return pickedFallback.path;
  });
