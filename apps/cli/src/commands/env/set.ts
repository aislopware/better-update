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

        const existing = yield* api["env-vars"].list({
          urlParams: { projectId, scope: "project" },
        });

        const match = existing.items.find((item) => item.key === key);
        const label = formatEnvironments(environments);

        if (match) {
          yield* api["env-vars"].update({
            path: { id: match.id },
            payload: { value, visibility, environments },
          });
          yield* Console.log(`Updated ${key} (environments: ${label})`);
        } else {
          yield* api["env-vars"].create({
            payload: { scope: "project", projectId, environments, key, value, visibility },
          });
          yield* Console.log(`Created ${key} (environments: ${label})`);
        }
      }),
      envErrorExtras,
    ),
});
