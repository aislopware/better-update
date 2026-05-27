import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { readProjectId } from "../../lib/expo-config";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, findProjectEnvVar, parseSingleEnvironmentArg } from "./helpers";

export const rollbackCommand = defineCommand({
  meta: {
    name: "rollback",
    description: "Roll a project env var back to an earlier value revision",
  },
  args: {
    key: { type: "positional", required: true, description: "Env var key" },
    to: {
      type: "string",
      required: true,
      description: "Target revision number (from `env history`) or revision id",
    },
    environment: {
      type: "string",
      default: "production",
      description: "Target environment (development, preview, production)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const environment = yield* parseSingleEnvironmentArg(args.environment);
        const projectId = yield* readProjectId;
        const api = yield* apiClient;

        const match = yield* findProjectEnvVar(api, projectId, args.key, environment);
        const { items } = yield* api["env-vars"].revisions({ path: { id: match.id } });
        const target = items.find(
          (revision) => revision.id === args.to || String(revision.revisionNumber) === args.to,
        );
        if (!target) {
          return yield* new InvalidArgumentError({
            message: `Revision "${args.to}" not found for ${args.key} (${environment}). See \`env history\`.`,
          });
        }

        yield* api["env-vars"].rollback({
          path: { id: match.id },
          payload: { toRevisionId: target.id },
        });
        yield* Console.log(
          `Rolled back ${args.key} (${environment}) to revision ${String(target.revisionNumber)}.`,
        );
        return undefined;
      }),
      envErrorExtras,
    ),
});
