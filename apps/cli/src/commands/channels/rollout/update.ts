import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { parseRolloutPercentage } from "../../../lib/cli-schemas";
import { printHuman } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { channelErrorExtras } from "../helpers";

export const updateCommand = defineCommand({
  meta: { name: "update", description: "Update the rollout percentage on a channel" },
  args: {
    channelId: { type: "positional", required: true, description: "Channel ID" },
    percentage: { type: "string", required: true, description: "New rollout percentage (1-100)" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const percentage = yield* parseRolloutPercentage(args.percentage, "percentage");
        const api = yield* apiClient;
        const channel = yield* api.channels.updateBranchRollout({
          path: { id: args.channelId },
          payload: { percentage },
        });

        yield* printHuman(
          `Updated rollout on channel "${channel.name}" to ${String(percentage)}%.`,
        );
        return channel;
      }),
      { exits: channelErrorExtras, json: "value" },
    ),
});
