import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { groupErrorExtras } from "../helpers";

export const removeGroupMemberCommand = defineCommand({
  meta: { name: "remove", description: "Remove a member from a group" },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
    "member-id": {
      type: "string",
      required: true,
      description: "Organization member ID to remove",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        yield* api.groups.removeMember({
          path: { id: args.id, memberId: args["member-id"] },
        });
        yield* printHuman(`Removed member ${args["member-id"]} from group ${args.id}.`);
        return { groupId: args.id, memberId: args["member-id"], removed: true };
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
