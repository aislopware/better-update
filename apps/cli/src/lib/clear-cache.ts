import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Console, Effect } from "effect";

/**
 * Project-scoped build cache directories to remove when --clear-cache is passed.
 * Intentionally avoids `~/.gradle/caches` (global) and `ios/Pods/` (requires
 * pod install rebuild — leave to the user).
 */
const CACHE_DIRS = [
  "android/.gradle",
  "android/app/build",
  "android/build",
  "ios/build",
  ".expo",
  "node_modules/.cache",
] as const;

export const clearBuildCaches = (
  projectRoot: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const removed: string[] = [];
    yield* Effect.forEach(
      CACHE_DIRS,
      (rel) =>
        Effect.gen(function* () {
          const target = path.join(projectRoot, rel);
          const exists = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false));
          if (!exists) {
            return;
          }
          yield* fs.remove(target, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));
          removed.push(rel);
        }),
      { concurrency: 4 },
    );
    if (removed.length > 0) {
      yield* Console.error(`Cleared caches: ${removed.join(", ")}`);
    }
  });
