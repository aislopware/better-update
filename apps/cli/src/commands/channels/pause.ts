import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras } from "./helpers";

export const pauseCommand = defineCommand({
  meta: { name: "pause", description: "Pause a channel" },
  args: {
    id: { type: "positional", required: true, description: "Channel ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const channel = yield* api.channels.pause({ path: { id: args.id } });
        yield* printHuman(`Channel "${channel.name}" paused.`);
        return channel;
      }),
      { exits: channelErrorExtras, json: "value" },
    ),
});
