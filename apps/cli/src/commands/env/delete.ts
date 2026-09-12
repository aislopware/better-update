import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { EnvResourceNotFoundError, listAllEnvVars, parseSingleEnvironmentArg } from "./helpers";

export const deleteCommand = Command.make(
  "delete",
  {
    key: Argument.String("key").pipe(Argument.withDescription("Env var key")),
    environment: Flag.String("environment").pipe(
      Flag.withDescription("Only delete this environment (default: every environment for the key)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const environment =
        args.environment === undefined
          ? undefined
          : yield* parseSingleEnvironmentArg(args.environment);
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      // `search` narrows server-side (substring match); the exact-key filter stays.
      const items = yield* listAllEnvVars(api, {
        projectId,
        scope: "project",
        search: args.key,
        ...(environment ? { environments: environment } : {}),
      });
      const matches = items.filter(
        (item) =>
          item.key === args.key && (environment === undefined || item.environment === environment),
      );

      if (matches.length === 0) {
        return yield* new EnvResourceNotFoundError({
          message: `Project env var "${args.key}" not found${environment ? ` for environment "${environment}"` : ""}.`,
        });
      }

      yield* Effect.forEach(
        matches,
        (match) => api["env-vars"].delete({ params: { id: match.id } }),
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Delete a project env var (one environment, or every environment by default)",
  ),
);
