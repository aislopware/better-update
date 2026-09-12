import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { parseKeyValue } from "../../lib/cli-schemas";
import { uploadEnvVars } from "../../lib/env-exporter";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { readProjectId } from "../../lib/project-link";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";
import { describePayload, formatEnvironments, parseEnvironmentsArg } from "./helpers";

export const setCommand = Command.make(
  "set",
  {
    keyValue: Argument.String("keyValue").pipe(
      Argument.withDescription("KEY=VALUE pair (e.g. API_KEY=abc123)"),
    ),
    environment: Flag.String("environment").pipe(
      Flag.withDescription(
        "Target environments (comma-separated, e.g. development,production). Default: production",
      ),
      Flag.withDefault("production"),
    ),
    visibility: Flag.Literals("visibility", ["plaintext", "sensitive"]).pipe(
      Flag.withDescription("Value visibility (build-log redaction hint)"),
      Flag.withDefault("plaintext"),
    ),
    label: Flag.String("label").pipe(
      Flag.withDescription(
        "Human-readable label documenting the variable (shared across environments; non-secret)",
      ),
      optionalFlag,
    ),
    description: Flag.String("description").pipe(
      Flag.withDescription("Longer description of what the variable is for (shared; non-secret)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const { key, value } = yield* parseKeyValue(args.keyValue);
      const environments = yield* parseEnvironmentsArg(args.environment);
      const { visibility } = args;
      const projectId = yield* readProjectId;
      const api = yield* apiClient;

      // The value is sealed client-side per (key, environment) and upserted;
      // the server stores only ciphertext. Requires vault access.
      const result = yield* uploadEnvVars(api, {
        scope: "project",
        projectId,
        environments,
        entries: [{ key, value, visibility }],
      });

      // Non-secret documentation is shared per (scope, key) across environments,
      // so it is a separate no-vault call made once after the value upsert.
      const docs = describePayload(args.label, args.description);
      if (docs) {
        yield* api["env-vars"].upsertDescription({
          payload: { scope: "project", projectId, key, ...docs },
        });
      }

      const label = formatEnvironments(environments);
      yield* printHuman(
        `Set ${key} (environments: ${label}; ${result.created} created, ${result.updated} updated)`,
      );
      return { key, environments, ...result };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Create or update a project-scoped environment variable"));
