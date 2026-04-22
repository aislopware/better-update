import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { parseRolloutPercentage } from "../../../lib/cli-schemas";
import { apiClient } from "../../../services/api-client";
import { updateErrorExtras } from "../helpers";

export const setCommand = defineCommand({
  meta: { name: "set", description: "Set the rollout percentage for an update" },
  args: {
    updateId: { type: "positional", required: true, description: "Update ID" },
    percentage: { type: "string", required: true, description: "Rollout percentage (1-100)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const percentage = yield* parseRolloutPercentage(args.percentage, "percentage");
        const api = yield* apiClient;
        const result = yield* api.updates.editRollout({
          path: { id: args.updateId },
          payload: { percentage },
        });

        yield* Console.log(
          `Updated rollout for ${args.updateId} to ${String(result.rolloutPercentage)}%.`,
        );
      }),
      updateErrorExtras,
    ),
});
