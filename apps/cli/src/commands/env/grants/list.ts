import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printList } from "../../../lib/output";
import { readProjectId } from "../../../lib/project-link";
import { apiClient } from "../../../services/api-client";
import { ENV_GRANT_GLOBAL, envGrantErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List env-var grants on a (project × environment) scope" },
  args: {
    project: {
      type: "string",
      description: `Project id, or "${ENV_GRANT_GLOBAL}" for the org-global scope (default: linked project)`,
    },
    global: {
      type: "boolean",
      default: false,
      description: "Target the org-global env-var scope instead of a project",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const projectId = args.global ? ENV_GRANT_GLOBAL : (args.project ?? (yield* readProjectId));
        const api = yield* apiClient;

        const rows = yield* api.envGrants.list({ urlParams: { projectId } });

        yield* printList(
          ["Member ID", "Environment", "Effect", "Actions"],
          rows.map((row) => [row.memberId, row.environment, row.effect, row.actions.join(", ")]),
          "No env-var grants found for this scope.",
        );
      }),
      { exits: { ...envGrantErrorExtras } },
    ),
});
