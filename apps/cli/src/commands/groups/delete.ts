import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { groupErrorExtras } from "./helpers";

export const deleteGroupCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a group and sweep its memberships and policy attachments",
  },
  args: {
    id: { type: "positional", required: true, description: "Group ID" },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!args.yes) {
          const confirmed = yield* promptConfirm(`Delete group ${args.id}?`, {
            initialValue: false,
          });
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return undefined;
          }
        }
        const api = yield* apiClient;
        yield* api.groups.delete({ path: { id: args.id } });
        yield* printHuman(`Deleted group ${args.id}.`);
        return { id: args.id, deleted: true };
      }),
      { exits: groupErrorExtras, json: "value" },
    ),
});
