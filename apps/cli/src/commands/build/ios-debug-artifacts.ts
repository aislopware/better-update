import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { formatCause } from "../../lib/format-error";
import { printWarn } from "../../lib/warning-style";
import { runStep } from "./run-step";

import type { CapturedDebugArtifact } from "../../lib/debug-artifacts";
import type { OutputMode } from "../../lib/output-mode";

/**
 * Best-effort post-archive capture of crash-symbolication files: the
 * xcarchive's dSYMs (zipped) and the embedded-bundle sourcemap written via
 * SOURCEMAP_FILE. Any failure resolves to an empty/partial list — symbols
 * must never fail a build whose artifact exported fine.
 */
export const collectIosDebugArtifacts = (params: {
  readonly archivePath: string;
  readonly tempDir: string;
  readonly embeddedSourcemapPath: string;
  readonly commandEnv: Record<string, string>;
}): Effect.Effect<
  readonly CapturedDebugArtifact[],
  never,
  FileSystem.FileSystem | CommandExecutor.CommandExecutor | OutputMode
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const artifacts: CapturedDebugArtifact[] = [];

    const dsymsDir = path.join(params.archivePath, "dSYMs");
    const dsymEntries = yield* fs.readDirectory(dsymsDir).pipe(Effect.orElseSucceed(() => []));
    if (dsymEntries.length > 0) {
      const dsymZipPath = path.join(params.tempDir, "dSYMs.zip");
      yield* runStep(
        {
          command: "zip",
          args: ["-r", "-q", dsymZipPath, "."],
          cwd: dsymsDir,
          env: params.commandEnv,
        },
        "zip dSYMs",
      );
      artifacts.push({ type: "dsym", path: dsymZipPath });
    }

    const hasSourcemap = yield* fs
      .exists(params.embeddedSourcemapPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (hasSourcemap) {
      artifacts.push({ type: "js-sourcemap", path: params.embeddedSourcemapPath });
    }

    return artifacts;
  }).pipe(
    Effect.catchAll((cause) =>
      printWarn(`Debug symbol capture skipped: ${formatCause(cause)}`).pipe(
        Effect.as([] as readonly CapturedDebugArtifact[]),
      ),
    ),
  );
