import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { parsePermissionTokens, roleErrorExtras } from "./helpers";

export const createCommand = defineCommand({
  meta: { name: "create", description: "Create a custom role" },
  args: {
    name: {
      type: "string",
      required: true,
      description: "Role name (unique per organization)",
    },
    permission: {
      type: "string",
      required: true,
      description:
        "Permission tokens in resource:action format, comma-separated (e.g. channel:read,channel:update)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const permissions = yield* parsePermissionTokens(args.permission);
        const api = yield* apiClient;

        const role = yield* api.roles.create({
          payload: { name: args.name, permissions },
        });

        yield* printHumanKeyValue([
          ["ID", role.id],
          ["Name", role.role],
          [
            "Permissions",
            role.permissions
              .map((perm) => `${perm.resource}:[${perm.actions.join(",")}]`)
              .join("; "),
          ],
          ["Created", role.createdAt],
        ]);
        return role;
      }),
      { exits: roleErrorExtras, json: "value" },
    ),
});
