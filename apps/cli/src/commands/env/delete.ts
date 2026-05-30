import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, envErrorExtras, parseSingleEnvironmentArg } from "./helpers";

export const deleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a project env var (one environment, or every environment by default)",
  },
  args: {
    key: { type: "positional", required: true, description: "Env var key" },
    environment: {
      type: "string",
      description: "Only delete this environment (default: every environment for the key)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const environment =
          args.environment === undefined
            ? undefined
            : yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const { items } = yield* api["env-vars"].list({
          urlParams: {
            projectId,
            scope: "project",
            ...(environment ? { environments: environment } : {}),
          },
        });
        const matches = items.filter(
          (item) =>
            item.key === args.key &&
            (environment === undefined || item.environment === environment),
        );

        if (matches.length === 0) {
          return yield* new EnvResourceNotFoundError({
            message: `Project env var "${args.key}" not found${environment ? ` for environment "${environment}"` : ""}.`,
          });
        }

        yield* Effect.forEach(
          matches,
          (match) => api["env-vars"].delete({ path: { id: match.id } }),
          {
            concurrency: 4,
          },
        );

        yield* printHuman(
          `Deleted ${args.key} (${String(matches.length)} environment${matches.length === 1 ? "" : "s"})`,
        );
        return {
          key: args.key,
          deleted: matches.length,
          environments: matches.map((match) => match.environment),
        };
      }),
      { exits: envErrorExtras, json: "value" },
    ),
});
