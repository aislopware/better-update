import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { groupErrorExtras } from "./helpers";

export const updateGroupCommand = defineCommand({
  meta: { name: "update", description: "Update a group's name or description" },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
    name: { type: "string", description: "New display name" },
    description: { type: "string", description: "New description" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const group = yield* api.groups.update({
          path: { id: args.id },
          payload: compact({
            name: args.name,
            description: args.description,
          }),
        });
        yield* printHumanKeyValue([
          ["ID", group.id],
          ["Name", group.name],
          ["Description", group.description ?? "-"],
          ["Updated", group.updatedAt ?? "-"],
        ]);
        return group;
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
