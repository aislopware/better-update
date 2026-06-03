import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printList } from "../../lib/output";
import { apiClient } from "../../services/api-client";
import { roleErrorExtras } from "./helpers";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List custom roles for the active organization" },
  args: {
    "organization-id": {
      type: "string",
      required: true,
      description: "Organization ID to list roles for",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const roles = yield* api.roles.list({
          urlParams: { organizationId: args["organization-id"] },
        });

        yield* printList(
          ["ID", "Name", "Permissions", "Created"],
          roles.map((role) => [
            role.id,
            role.role,
            role.permissions
              .map((perm) => `${perm.resource}:[${perm.actions.join(",")}]`)
              .join("; "),
            role.createdAt,
          ]),
          "No custom roles found.",
        );
      }),
      roleErrorExtras,
    ),
});
