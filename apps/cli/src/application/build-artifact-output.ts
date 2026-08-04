import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { BuildProfileError } from "../lib/exit-codes";
import { formatCause } from "../lib/format-error";
import { printHuman } from "../lib/output";

import type { OutputMode } from "../lib/output-mode";

const failWith = (what: string) => (cause: unknown) =>
  new BuildProfileError({ message: `${what}: ${formatCause(cause)}` });

/**
 * `build --output <path>`: copy the produced artifact where the user asked for
 * it, creating the directory. Resolved against the user's cwd, not the staging
 * tree the build ran in — that copy is deleted when the build scope closes.
 *
 * Returns the resolved path so the summary can surface it.
 */
export const exportArtifact = (params: {
  readonly artifactPath: string;
  readonly userCwd: string;
  readonly output: string;
}): Effect.Effect<string, BuildProfileError, FileSystem.FileSystem | OutputMode> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const outputPath = path.resolve(params.userCwd, params.output);
    yield* fs
      .makeDirectory(path.dirname(outputPath), { recursive: true })
      .pipe(Effect.mapError(failWith("Failed to create output directory")));
    yield* fs
      .copyFile(params.artifactPath, outputPath)
      .pipe(Effect.mapError(failWith(`Failed to copy artifact to ${outputPath}`)));
    yield* printHuman(`Copied artifact to ${outputPath}`);
    return outputPath;
  });
