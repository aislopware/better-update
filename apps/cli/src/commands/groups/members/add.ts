import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHumanKeyValue } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { groupErrorExtras } from "../helpers";

export const addGroupMemberCommand = defineCommand({
  meta: { name: "add", description: "Add an organization member to a group" },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
    "member-id": {
      type: "string",
      required: true,
      description: "Organization member ID to add",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const member = yield* api.groups.addMember({
          path: { id: args.id },
          payload: { memberId: args["member-id"] },
        });
        yield* printHumanKeyValue([
          ["Member ID", member.memberId],
          ["Added", member.createdAt],
        ]);
        return member;
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
