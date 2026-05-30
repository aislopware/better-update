import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { updateErrorExtras } from "./helpers";

export const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete an update group" },
  args: {
    groupId: { type: "positional", required: true, description: "Update group ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.updates.deleteGroup({ path: { groupId: args.groupId } });
        yield* printHuman(
          `Deleted ${String(result.deleted)} update(s) from group ${args.groupId}.`,
        );
        return { groupId: args.groupId, ...result };
      }),
      { exits: updateErrorExtras, json: "value" },
    ),
});
