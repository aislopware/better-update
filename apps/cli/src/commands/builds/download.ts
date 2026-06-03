import { Buffer } from "node:buffer";
import path from "node:path";

import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { UploadFailedError } from "../../lib/exit-codes";
import { formatCause } from "../../lib/format-error";
import { printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

const EXIT_EXTRAS = { UploadFailedError: 7 } as const;

const fetchArtifact = (url: string): Effect.Effect<Buffer, UploadFailedError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async () => fetch(url),
      catch: (cause) =>
        new UploadFailedError({
          message: `Failed to request artifact: ${formatCause(cause)}`,
        }),
    });
    if (!response.ok) {
      return yield* new UploadFailedError({
        message: `Failed to download artifact: HTTP ${String(response.status)} ${response.statusText}`,
      });
    }
    const buffer = yield* Effect.tryPromise({
      try: async () => response.arrayBuffer(),
      catch: (cause) =>
        new UploadFailedError({
          message: `Failed to read artifact body: ${formatCause(cause)}`,
        }),
    });
    return Buffer.from(buffer);
  });

export const downloadCommand = defineCommand({
  meta: {
    name: "download",
    description: "Download the artifact for a build (.ipa/.apk/.aab) to a local path",
  },
  args: {
    id: { type: "positional", required: true, description: "Build ID" },
    output: {
      type: "string",
      description: "Output path (default: ./<id>.<ext> inferred from artifact format)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const fs = yield* FileSystem.FileSystem;
        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;

        const build = yield* api.builds.get({ path: { id: args.id } });
        const { artifact } = build;
        if (!artifact) {
          return yield* new UploadFailedError({
            message: `Build ${args.id} has no artifact yet.`,
          });
        }

        const link = yield* api.builds.getInstallLink({ path: { id: args.id } });
        const ext = artifact.format;
        const outputPath = args.output ?? path.join(cwd, `${args.id}.${ext}`);

        const bytes = yield* fetchArtifact(link.artifactUrl);
        yield* fs.writeFile(outputPath, bytes);

        yield* printKeyValue([
          ["Path", outputPath],
          ["Format", ext],
          ["Size", `${String(bytes.byteLength)} bytes`],
        ]);
      }),
      EXIT_EXTRAS,
    ),
});
