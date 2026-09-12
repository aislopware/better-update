import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { findProjectEnvVar, parseSingleEnvironmentArg } from "./helpers";

export const rollbackCommand = Command.make(
  "rollback",
  {
    key: Argument.String("key").pipe(Argument.withDescription("Env var key")),
    to: Flag.String("to").pipe(
      Flag.withDescription("Target revision number (from `env history`) or revision id"),
    ),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Target environment (development, preview, production)"),
      Flag.withDefault("production"),
    ),
  },
  Effect.fn(
    function* (args) {
      const environment = yield* parseSingleEnvironmentArg(args.environment);
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      const match = yield* findProjectEnvVar(api, projectId, args.key, environment);
      const { items } = yield* api["env-vars"].revisions({ params: { id: match.id } });
      const target = items.find(
        (revision) => revision.id === args.to || String(revision.revisionNumber) === args.to,
      );
      if (!target) {
        return yield* new InvalidArgumentError({
          message: `Revision "${args.to}" not found for ${args.key} (${environment}). See \`env history\`.`,
        });
      }

      const result = yield* api["env-vars"].rollback({
        params: { id: match.id },
        payload: { toRevisionId: target.id },
      });
      yield* printHuman(
        `Rolled back ${args.key} (${environment}) to revision ${String(target.revisionNumber)}.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Roll a project env var back to an earlier value revision"));
