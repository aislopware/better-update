import path from "node:path";

import { DebugArtifactType } from "@better-update/api";
import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { UploadFailedError } from "../../lib/exit-codes";
import { fetchBytes } from "../../lib/fetch-bytes";
import { printHuman, printKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

const EXIT_EXTRAS = { UploadFailedError: 7 } as const;

const FILE_EXT: Record<typeof DebugArtifactType.Type, string> = {
  dsym: "zip",
  "js-sourcemap": "map",
  "proguard-mapping": "txt",
  "native-symbols": "zip",
};

const DEBUG_ARTIFACT_TYPES = DebugArtifactType.literals;

const asDebugArtifactType = (value: string): typeof DebugArtifactType.Type | undefined =>
  DEBUG_ARTIFACT_TYPES.find((type) => type === value);

export const downloadSymbolsCommand = defineCommand({
  meta: {
    name: "download-symbols",
    description:
      "Download the stored debug symbols of a build (dSYM, JS sourcemap, R8 mapping, native symbols) for crash symbolication",
  },
  args: {
    id: { type: "positional", required: true, description: "Build ID" },
    type: {
      type: "string",
      description:
        "Only download one artifact type (dsym | js-sourcemap | proguard-mapping | native-symbols)",
    },
    output: {
      type: "string",
      description: "Output directory (default: current directory)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const fs = yield* FileSystem.FileSystem;
        const runtime = yield* CliRuntime;
        const cwd = yield* runtime.cwd;

        const requestedType = args.type === undefined ? undefined : asDebugArtifactType(args.type);
        if (args.type !== undefined && requestedType === undefined) {
          return yield* new UploadFailedError({
            message: `Unknown debug artifact type "${args.type}". Expected one of: ${DEBUG_ARTIFACT_TYPES.join(", ")}.`,
          });
        }

        const { items } = yield* api.builds.listDebugArtifacts({ path: { id: args.id } });
        const wanted = requestedType ? items.filter((item) => item.type === requestedType) : items;
        if (wanted.length === 0) {
          return yield* new UploadFailedError({
            message: requestedType
              ? `Build ${args.id} has no ${requestedType} debug artifact.`
              : `Build ${args.id} has no stored debug artifacts. Rebuild with a current CLI to capture them.`,
          });
        }

        const outputDir = path.resolve(cwd, args.output ?? ".");
        yield* fs
          .makeDirectory(outputDir, { recursive: true })
          .pipe(Effect.orElseSucceed(() => undefined));

        const rows = yield* Effect.forEach(
          wanted,
          (item) =>
            Effect.gen(function* () {
              const download = yield* api.builds.getDebugArtifactDownload({
                path: { id: args.id, type: item.type },
              });
              const bytes = yield* fetchBytes(download.url, "debug artifact");
              const outputPath = path.join(
                outputDir,
                `${args.id}-${item.type}.${FILE_EXT[item.type]}`,
              );
              yield* fs.writeFile(outputPath, bytes);
              return [item.type, outputPath] as const;
            }),
          { concurrency: 2 },
        );

        yield* printHuman(`Downloaded ${String(rows.length)} debug artifact(s):`);
        yield* printKeyValue(rows);
      }),
      EXIT_EXTRAS,
    ),
});
