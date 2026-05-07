import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseKeyValue } from "../../lib/cli-schemas";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { envErrorExtras } from "./helpers";

export const setCommand = defineCommand({
  meta: { name: "set", description: "Create or update an environment variable" },
  args: {
    keyValue: {
      type: "positional",
      required: true,
      description: "KEY=VALUE pair (e.g. API_KEY=abc123)",
    },
    environment: { type: "string", default: "production", description: "Target environment" },
    visibility: {
      type: "enum",
      options: ["plaintext", "sensitive", "secret"],
      default: "plaintext",
      description: "Value visibility",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { key, value } = yield* parseKeyValue(args.keyValue);
        const { environment } = args;
        const { visibility } = args;
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const existing = yield* api["env-vars"].list({
          urlParams: { projectId, environment },
        });

        const match = existing.items.find((item) => item.key === key);

        if (match) {
          yield* api["env-vars"].update({
            path: { id: match.id },
            payload: { value, visibility },
          });
          yield* Console.log(`Updated ${key} in ${environment}`);
        } else {
          yield* api["env-vars"].create({
            payload: { projectId, environment, key, value, visibility },
          });
          yield* Console.log(`Created ${key} in ${environment}`);
        }
      }),
      envErrorExtras,
    ),
});
