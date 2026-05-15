import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, parseEnvironmentsArg } from "./helpers";

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

        const environments = yield* parseEnvironmentsArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const result = yield* api["env-vars"].bulkImport({
          payload: {
            scope: "project",
            projectId,
            environments,
            content,
            visibility: args.visibility,
          },
        });

        yield* Console.log(
          `Imported: ${String(result.created)} created, ${String(result.updated)} updated, ${String(result.skipped)} skipped`,
        );
      }),
      envErrorExtras,
    ),
});
