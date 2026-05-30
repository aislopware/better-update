import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { channelErrorExtras } from "./helpers";

export const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a channel" },
  args: {
    id: { type: "positional", required: true, description: "Channel ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api.channels.delete({ path: { id: args.id } });
        yield* printHuman(`Channel ${args.id} deleted.`);
        return { id: args.id, deleted: true };
      }),
      { exits: channelErrorExtras, json: "value" },
    ),
});
