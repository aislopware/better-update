import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";

export const viewCommand = defineCommand({
  meta: { name: "view", description: "Show details for a single update" },
  args: {
    id: { type: "positional", required: true, description: "Update ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const update = yield* api.updates.get({ path: { id: args.id } });
        yield* printHumanKeyValue([
          ["ID", update.id],
          ["Group ID", update.groupId],
          ["Branch ID", update.branchId],
          ["Platform", update.platform],
          ["Runtime version", update.runtimeVersion],
          ["Rollout %", String(update.rolloutPercentage)],
          ["Is rollback", update.isRollback ? "yes" : "no"],
          ["Created", update.createdAt],
          ["Message", update.message],
        ]);
        return update;
      }),
      { json: "value" },
    ),
});
