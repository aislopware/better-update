import path from "node:path";

import { FileSystem, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { UploadFailedError } from "../../lib/exit-codes";
import { fetchBytes } from "../../lib/fetch-bytes";
import { printKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

export const sourcemapCommand = Command.make(
  "sourcemap",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Update ID")),
    output: Flag.String("output").pipe(
      Flag.withDescription("Output path (default: ./<update-id>.map)"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
    const api = yield* apiClient;
    const fs = yield* FileSystem.FileSystem;
    const runtime = yield* CliRuntime;
    const cwd = yield* runtime.cwd;

    // The download endpoint's NotFound already covers both "no such
    // update" and "update has no sourcemap" — no need for a separate
    // existence pre-check round trip.
    const download = yield* api.updates.getSourcemapDownload({ params: { id: args.id } }).pipe(
      Effect.catchTag(
        "NotFound",
        () =>
          new UploadFailedError({
            message: `Update ${args.id} was not found or has no stored sourcemap. Publish with --source-maps (on by default in current CLIs) to capture one.`,
          }),
      ),
    );
    const bytes = yield* fetchBytes(download.url, "sourcemap");
    const outputPath = path.resolve(cwd, args.output ?? `${args.id}.map`);
    yield* fs.writeFile(outputPath, bytes);

    yield* printKeyValue([
      ["Path", outputPath],
      ["Size", `${String(bytes.byteLength)} bytes`],
    ]);
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Download the stored JS bundle sourcemap of an update for crash symbolication",
  ),
);
