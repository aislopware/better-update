import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { envErrorExtras } from "./helpers";

export const importCommand = defineCommand({
  meta: { name: "import", description: "Bulk-import env vars from a dotenv file" },
  args: {
    file: { type: "positional", required: true, description: "Path to .env file" },
    environment: { type: "string", default: "production", description: "Target environment" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const content = yield* fs.readFileString(args.file);

        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const result = yield* api["env-vars"].bulkImport({
          payload: { projectId, environment: args.environment, content, visibility: "plaintext" },
        });

        yield* Console.log(
          `Imported: ${String(result.created)} created, ${String(result.updated)} updated, ${String(result.skipped)} skipped`,
        );
      }),
      envErrorExtras,
    ),
});
