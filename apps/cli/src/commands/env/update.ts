import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, envErrorExtras, parseEnvironmentsArg } from "./helpers";

export const updateCommand = defineCommand({
  meta: {
    name: "update",
    description: "Update a project env var's value, visibility, or environments",
  },
  args: {
    key: { type: "positional", required: true, description: "Env var key (e.g. API_KEY)" },
    value: { type: "string", description: "New value (leave unset to keep current)" },
    visibility: {
      type: "enum",
      options: ["plaintext", "sensitive"],
      description: "New visibility (leave unset to keep current)",
    },
    environments: {
      type: "string",
      description:
        "New environments assignment (comma-separated, e.g. development,production). Leave unset to keep current.",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const { key, value, visibility, environments } = args;

        if (value === undefined && visibility === undefined && environments === undefined) {
          return yield* new InvalidArgumentError({
            message:
              "Pass --value, --visibility, --environments (or any combination). Nothing to update otherwise.",
          });
        }

        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const existing = yield* api["env-vars"].list({
          urlParams: { projectId, scope: "project" },
        });
        const match = existing.items.find((item) => item.key === key);
        if (!match) {
          return yield* new EnvResourceNotFoundError({
            message: `Env var "${key}" not found in project.`,
          });
        }

        const envList = environments ? yield* parseEnvironmentsArg(environments) : undefined;

        const payload = {
          ...(value === undefined ? {} : { value }),
          ...(visibility === undefined ? {} : { visibility }),
          ...(envList ? { environments: envList } : {}),
        };
        yield* api["env-vars"].update({ path: { id: match.id }, payload });

        const changed: string[] = [];
        if (value !== undefined) {
          changed.push("value");
        }
        if (visibility !== undefined) {
          changed.push("visibility");
        }
        if (envList) {
          changed.push("environments");
        }
        yield* printHuman(`Updated ${changed.join(" + ")} for ${key}.`);
        return undefined;
      }),
      envErrorExtras,
    ),
});
