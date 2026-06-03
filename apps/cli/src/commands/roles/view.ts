import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { roleErrorExtras } from "./helpers";

export const viewCommand = defineCommand({
  meta: { name: "view", description: "Show a custom role by ID" },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "Role ID",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const role = yield* api.roles.get({ path: { id: args.id } });

        yield* printHumanKeyValue([
          ["ID", role.id],
          ["Name", role.role],
          ["Organization ID", role.organizationId],
          [
            "Permissions",
            role.permissions
              .map((perm) => `${perm.resource}:[${perm.actions.join(",")}]`)
              .join("; "),
          ],
          ["Created", role.createdAt],
          ["Updated", role.updatedAt ?? "-"],
        ]);
        return role;
      }),
      { exits: roleErrorExtras, json: "value" },
    ),
});
