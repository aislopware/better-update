import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
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
        yield* Console.log(`Channel "${channel.name}" paused.`);
      }),
      channelErrorExtras,
    ),
});
