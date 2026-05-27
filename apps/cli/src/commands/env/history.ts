import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { readProjectId } from "../../lib/expo-config";
import { printList } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { envErrorExtras, findProjectEnvVar, parseSingleEnvironmentArg } from "./helpers";

export const historyCommand = defineCommand({
  meta: {
    name: "history",
    description: "Show a project env var's value revision history (metadata only)",
  },
  args: {
    key: { type: "positional", required: true, description: "Env var key" },
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

        yield* printList(
          ["Revision", "Active", "Vault", "Created", "By"],
          items.map((revision) => [
            String(revision.revisionNumber),
            revision.isCurrent ? "current" : "",
            String(revision.vaultVersion),
            revision.createdAt,
            revision.createdBy ?? "-",
          ]),
          "No revisions found.",
        );
      }),
      envErrorExtras,
    ),
});
