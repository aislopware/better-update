import path from "node:path";

import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { UploadFailedError } from "../../lib/exit-codes";
import { fetchBytes } from "../../lib/fetch-bytes";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

const EXIT_EXTRAS = { UploadFailedError: 7 } as const;

export const sourcemapCommand = defineCommand({
  meta: {
    name: "sourcemap",
    description: "Download the stored JS bundle sourcemap of an update for crash symbolication",
  },
  args: {
    id: { type: "positional", required: true, description: "Update ID" },
    output: {
      type: "string",
      description: "Output path (default: ./<update-id>.map)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const fs = yield* FileSystem.FileSystem;
        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;

        // The download endpoint's NotFound already covers both "no such
        // update" and "update has no sourcemap" — no need for a separate
        // existence pre-check round trip.
        const download = yield* api.updates.getSourcemapDownload({ path: { id: args.id } }).pipe(
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
      }),
      EXIT_EXTRAS,
    ),
});
