import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, envErrorExtras } from "./helpers";

export const updateCommand = defineCommand({
  meta: { name: "update", description: "Update an env var's value or visibility" },
  args: {
    key: { type: "positional", required: true, description: "Env var key (e.g. API_KEY)" },
    value: { type: "string", description: "New value (leave unset to keep current)" },
    visibility: {
      type: "enum",
      options: ["plaintext", "sensitive", "secret"],
      description: "New visibility (leave unset to keep current)",
    },
    environment: { type: "string", default: "production", description: "Target environment" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { key, value, visibility, environment } = args;

        if (value === undefined && visibility === undefined) {
          return yield* new InvalidArgumentError({
            message: "Pass --value, --visibility, or both. Nothing to update otherwise.",
          });
        }

        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const existing = yield* api["env-vars"].list({
          urlParams: { projectId, environment },
        });
        const match = existing.items.find((item) => item.key === key);
        if (!match) {
          return yield* new EnvResourceNotFoundError({
            message: `Env var "${key}" not found in environment "${environment}".`,
          });
        }

        const payload = {
          ...(value === undefined ? {} : { value }),
          ...(visibility === undefined ? {} : { visibility }),
        };
        yield* api["env-vars"].update({ path: { id: match.id }, payload });

        const changed: string[] = [];
        if (value !== undefined) {
          changed.push("value");
        }
        if (visibility !== undefined) {
          changed.push("visibility");
        }
        yield* printHuman(`Updated ${changed.join(" + ")} for ${key} in ${environment}.`);
        return undefined;
      }),
      envErrorExtras,
    ),
});
