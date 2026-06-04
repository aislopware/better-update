import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHumanTable } from "../../../lib/output";
import { apiClient } from "../../../services/api-client";
import { groupErrorExtras } from "../helpers";
import { addGroupMemberCommand } from "./add";
import { removeGroupMemberCommand } from "./remove";

const listGroupMembersCommand = defineCommand({
  meta: { name: "list", description: "List the members belonging to a group" },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const result = yield* api.groups.listMembers({
          path: { id: args.id },
        });
        yield* printHumanTable(
          ["Member ID", "Added"],
          result.items.map((member) => [member.memberId, member.createdAt]),
        );
        return result;
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});

export const membersCommand = defineCommand({
  meta: { name: "members", description: "Manage the members of a group" },
  subCommands: {
    list: listGroupMembersCommand,
    add: addGroupMemberCommand,
    remove: removeGroupMemberCommand,
  },
});
