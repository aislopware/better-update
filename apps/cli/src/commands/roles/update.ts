import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHumanKeyValue } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { parsePermissionTokens, roleErrorExtras } from "./helpers";

export const updateCommand = defineCommand({
  meta: { name: "update", description: "Update a custom role's name or permissions" },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "Role ID",
    },
    name: {
      type: "string",
      description: "New role name",
    },
    permission: {
      type: "string",
      description:
        "Replacement permission tokens in resource:action format, comma-separated (e.g. channel:read,channel:update)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const permissions =
          args.permission === undefined ? undefined : yield* parsePermissionTokens(args.permission);

        const api = yield* apiClient;

        const role = yield* api.roles.update({
          path: { id: args.id },
          payload: compact({ name: args.name, permissions }),
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
          ["Updated", role.updatedAt ?? "-"],
        ]);
        return role;
      }),
      { exits: roleErrorExtras, json: "value" },
    ),
});
