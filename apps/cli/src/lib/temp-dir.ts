import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

/**
 * Create a scoped temp directory prefixed with "better-update-" and `chmod 0o700`
 * it so only the current user can read its contents. The directory and all files
 * inside it are removed when the enclosing scope closes.
 */
export const acquireBuildTempDir = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "better-update-" });
  yield* fs.chmod(dir, 0o700);
  return dir;
});
