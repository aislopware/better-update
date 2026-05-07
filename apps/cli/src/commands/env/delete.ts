import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, envErrorExtras } from "./helpers";

export const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete an environment variable by key" },
  args: {
    key: { type: "positional", required: true, description: "Env var key" },
    environment: { type: "string", default: "production", description: "Target environment" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const existing = yield* api["env-vars"].list({
          urlParams: { projectId, environment: args.environment },
        });

        const match = existing.items.find((item) => item.key === args.key);

        if (!match) {
          return yield* new EnvResourceNotFoundError({
            message: `Environment variable ${args.key} not found in ${args.environment}`,
          });
        }

        yield* api["env-vars"].delete({ path: { id: match.id } });
        yield* Console.log(`Deleted ${args.key} from ${args.environment}`);
        return undefined;
      }),
      envErrorExtras,
    ),
});
