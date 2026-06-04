import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { groupErrorExtras } from "./helpers";

export const createGroupCommand = defineCommand({
  meta: { name: "create", description: "Create a member group" },
  args: {
    name: { type: "string", required: true, description: "Group display name" },
    description: { type: "string", description: "Optional human description" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const group = yield* api.groups.create({
          payload: {
            name: args.name,
            ...compact({ description: args.description }),
          },
        });
        yield* printHumanKeyValue([
          ["ID", group.id],
          ["Name", group.name],
          ["Description", group.description ?? "-"],
          ["Created", group.createdAt],
        ]);
        return group;
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
