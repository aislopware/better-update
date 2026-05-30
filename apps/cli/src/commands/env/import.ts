import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { uploadEnvVars } from "../../lib/env-exporter";
import { readProjectId } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, parseDotenv, parseEnvironmentsArg } from "./helpers";

export const importCommand = defineCommand({
  meta: { name: "import", description: "Bulk-import env vars from a dotenv file" },
  args: {
    file: { type: "positional", required: true, description: "Path to .env file" },
    environment: {
      type: "string",
      default: "production",
      description:
        "Target environments (comma-separated, e.g. development,production). Default: production",
    },
    visibility: {
      type: "enum",
      options: ["plaintext", "sensitive"],
      default: "plaintext",
      description: "Visibility applied to all imported values",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: envErrorExtras, json: "value" },
    ),
});
