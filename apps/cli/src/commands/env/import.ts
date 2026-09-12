import { FileSystem, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { uploadEnvVars } from "../../lib/env-exporter";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { parseDotenv, parseEnvironmentsArg } from "./helpers";

export const importCommand = Command.make(
  "import",
  {
    file: Argument.String("file").pipe(Argument.withDescription("Path to .env file")),
    environment: Flag.String("environment").pipe(
      Flag.withDescription(
        "Target environments (comma-separated, e.g. development,production). Default: production",
      ),
      Flag.withDefault("production"),
    ),
    visibility: Flag.Literals("visibility", ["plaintext", "sensitive"]).pipe(
      Flag.withDescription("Visibility applied to all imported values"),
      Flag.withDefault("plaintext"),
    ),
  },
  Effect.fn(
    function* (args) {
      const fs = yield* FileSystem.FileSystem;
      const content = yield* fs.readFileString(args.file);
      const entries = parseDotenv(content).map((entry) => ({
        key: entry.key,
        value: entry.value,
        visibility: args.visibility,
      }));

      if (entries.length === 0) {
        yield* printHuman(`No valid KEY=VALUE entries found in ${args.file}.`);
        return { created: 0, updated: 0, skipped: 0 };
      }

      const environments = yield* parseEnvironmentsArg(args.environment);
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      // Values are parsed and sealed locally, then upserted as opaque envelopes.
      const result = yield* uploadEnvVars(api, {
        scope: "project",
        projectId,
        environments,
        entries,
      });

      yield* printHuman(
        `Imported: ${String(result.created)} created, ${String(result.updated)} updated, ${String(result.skipped)} skipped`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Bulk-import env vars from a dotenv file"));
