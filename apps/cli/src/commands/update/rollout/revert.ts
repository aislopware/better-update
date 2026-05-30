import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { updateErrorExtras } from "../helpers";

export const revertCommand = defineCommand({
  meta: { name: "revert", description: "Revert the rollout for an update" },
  args: {
    updateId: { type: "positional", required: true, description: "Update ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.updates.revertRollout({ path: { id: args.updateId } });
        yield* printHuman(
          `Reverted rollout for ${args.updateId}. Current rollout is ${String(result.rolloutPercentage)}%.`,
        );
        return result;
      }),
      { exits: updateErrorExtras, json: "value" },
    ),
});
