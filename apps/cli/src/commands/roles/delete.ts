import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { promptConfirm } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { roleErrorExtras } from "./helpers";

export const deleteCommand = defineCommand({
  meta: { name: "delete", description: "Delete a custom role" },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "Role ID",
    },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        if (!args.yes) {
          const confirmed = yield* promptConfirm(`Delete role ${args.id}?`, {
            initialValue: false,
          });
          if (!confirmed) {
            yield* printHuman("Cancelled.");
            return { deleted: 0 };
          }
        }

        const api = yield* apiClient;
        const result = yield* api.roles.delete({ path: { id: args.id } });
        yield* printHuman(`Role ${args.id} deleted.`);
        return result;
      }),
      { exits: roleErrorExtras, json: "value" },
    ),
});
