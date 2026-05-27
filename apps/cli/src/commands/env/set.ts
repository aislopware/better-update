import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseKeyValue } from "../../lib/cli-schemas";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, formatEnvironments, parseEnvironmentsArg } from "./helpers";

export const setCommand = defineCommand({
  meta: { name: "set", description: "Create or update a project-scoped environment variable" },
  args: {
    keyValue: {
      type: "positional",
      required: true,
      description: "KEY=VALUE pair (e.g. API_KEY=abc123)",
    },
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
      description: "Value visibility",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { key, value } = yield* parseKeyValue(args.keyValue);
        const environments = yield* parseEnvironmentsArg(args.environment);
        const { visibility } = args;
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        // Each (key, environment) is its own variable, so set is an upsert per
        // environment: bulk-import creates the pair where it is new and updates
        // the value where it already exists.
        const result = yield* api["env-vars"].bulkImport({
          payload: {
            scope: "project",
            projectId,
            environments,
            visibility,
            entries: [{ key, value, visibility }],
          },
        });

        const label = formatEnvironments(environments);
        yield* Console.log(
          `Set ${key} (environments: ${label}; ${result.created} created, ${result.updated} updated)`,
        );
      }),
      envErrorExtras,
    ),
});
