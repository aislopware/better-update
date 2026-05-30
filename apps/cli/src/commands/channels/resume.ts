import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras } from "./helpers";

export const resumeCommand = defineCommand({
  meta: { name: "resume", description: "Resume a paused channel" },
  args: {
    id: { type: "positional", required: true, description: "Channel ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const channel = yield* api.channels.resume({ path: { id: args.id } });
        yield* printHuman(`Channel "${channel.name}" resumed.`);
        return channel;
      }),
      { exits: channelErrorExtras, json: "value" },
    ),
});
