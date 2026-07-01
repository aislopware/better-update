import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { parseKeyValue } from "../../lib/cli-schemas";
import { uploadEnvVars } from "../../lib/env-exporter";
import { printHuman } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import {
  describePayload,
  envErrorExtras,
  formatEnvironments,
  parseEnvironmentsArg,
} from "./helpers";

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
      description: "Value visibility (build-log redaction hint)",
    },
    label: {
      type: "string",
      description:
        "Human-readable label documenting the variable (shared across environments; non-secret)",
    },
    description: {
      type: "string",
      description: "Longer description of what the variable is for (shared; non-secret)",
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
      }),
      { exits: envErrorExtras, json: "value" },
    ),
});
