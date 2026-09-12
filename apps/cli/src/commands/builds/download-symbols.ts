import path from "node:path";

import { DebugArtifactType } from "@better-update/api";
import { FileSystem, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { UploadFailedError } from "../../lib/exit-codes";
import { fetchBytes } from "../../lib/fetch-bytes";
import { printHuman, printKeyValue } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

const FILE_EXT: Record<typeof DebugArtifactType.Type, string> = {
  dsym: "zip",
  "js-sourcemap": "map",
  "proguard-mapping": "txt",
  "native-symbols": "zip",
};

const DEBUG_ARTIFACT_TYPES = DebugArtifactType.literals;

const asDebugArtifactType = (value: string): typeof DebugArtifactType.Type | undefined =>
  DEBUG_ARTIFACT_TYPES.find((type) => type === value);

export const downloadSymbolsCommand = Command.make(
  "download-symbols",
  {
    id: Argument.String("id").pipe(Argument.withDescription("Build ID")),
    type: Flag.String("type").pipe(
      Flag.withDescription(
        "Only download one artifact type (dsym | js-sourcemap | proguard-mapping | native-symbols)",
      ),
      optionalFlag,
    ),
    output: Flag.String("output").pipe(
      Flag.withDescription("Output directory (default: current directory)"),
      optionalFlag,
    ),
  },
  Effect.fn(function* (args) {
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

    const { items } = yield* api.builds.listDebugArtifacts({ params: { id: args.id } });
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
            params: { id: args.id, type: item.type },
          });
          const bytes = yield* fetchBytes(download.url, "debug artifact");
          const outputPath = path.join(outputDir, `${args.id}-${item.type}.${FILE_EXT[item.type]}`);
          yield* fs.writeFile(outputPath, bytes);
          return [item.type, outputPath] as const;
        }),
      { concurrency: 2 },
    );

    yield* printHuman(`Downloaded ${String(rows.length)} debug artifact(s):`);
    yield* printKeyValue(rows);
  }, runCommand()),
).pipe(
  Command.withDescription(
    "Download the stored debug symbols of a build (dSYM, JS sourcemap, R8 mapping, native symbols) for crash symbolication",
  ),
);
