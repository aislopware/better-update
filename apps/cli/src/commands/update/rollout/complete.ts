import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { apiClient } from "../../../services/api-client";
import { updateErrorExtras } from "../helpers";

export const completeCommand = defineCommand({
  meta: { name: "complete", description: "Complete the rollout for an update" },
  args: {
    updateId: { type: "positional", required: true, description: "Update ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.updates.completeRollout({ path: { id: args.updateId } });
        yield* Console.log(
          `Completed rollout for ${args.updateId}. Current rollout is ${String(result.rolloutPercentage)}%.`,
        );
      }),
      updateErrorExtras,
    ),
});
