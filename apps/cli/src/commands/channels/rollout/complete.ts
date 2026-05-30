import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { channelErrorExtras } from "../helpers";

export const completeCommand = defineCommand({
  meta: { name: "complete", description: "Complete the active branch rollout" },
  args: {
    channelId: { type: "positional", required: true, description: "Channel ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const channel = yield* api.channels.completeBranchRollout({
          path: { id: args.channelId },
        });
        yield* printHuman(`Completed rollout on channel "${channel.name}".`);
        return channel;
      }),
      { exits: channelErrorExtras, json: "value" },
    ),
});
