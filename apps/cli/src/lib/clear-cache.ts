import os from "node:os";
import path from "node:path";

import { FileSystem, Console, Effect } from "effect";

/**
 * What `--clear-cache` clears.
 *
 * Every build runs in a fresh staged copy (see `prepareStagingProject`), so
 * project-scoped dirs (`android/build`, `ios/build`, `.expo`,
 * `node_modules/.cache`) start empty on every build anyway, and the copies in
 * the user's checkout never reach the build. The caches that DO carry state
 * from one build into the next live outside the project:
 *
 * - Metro's transform cache and haste maps, kept under the system temp dir
 *   (`metro-cache`, `haste-map-*`) and shared by every build on the machine;
 * - Gradle's build cache (`org.gradle.caching`), which the Android build skips
 *   for the run with `--no-build-cache` (see `runGradleBuild`). It is not
 *   deleted: `~/.gradle` is shared with every other Gradle project.
 */
const isMetroCacheEntry = (name: string) => name === "metro-cache" || name.startsWith("haste-map");

/**
 * Remove Metro's caches from the temp dir the build's Metro sees: `TMPDIR` in
 * the build's command environment, else `os.tmpdir()`. Best-effort: an entry
 * that cannot be removed is skipped.
 */
export const clearBuildCaches = (
  commandEnv: Readonly<Record<string, string>>,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tempRoot = commandEnv["TMPDIR"] || os.tmpdir();
    const entries = yield* fs.readDirectory(tempRoot).pipe(Effect.orElseSucceed(() => []));
    const removed = yield* Effect.forEach(
      entries.filter(isMetroCacheEntry),
      (name) =>
        fs.remove(path.join(tempRoot, name), { recursive: true }).pipe(
          Effect.as([name]),
          Effect.orElseSucceed(() => []),
        ),
      { concurrency: 4 },
    );
    const names = removed.flat();
    yield* Console.error(
      names.length === 0
        ? "No Metro cache to clear."
        : `Cleared Metro caches in ${tempRoot}: ${names.join(", ")}`,
    );
  });
