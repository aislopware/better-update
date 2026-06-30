import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../../application/app-store-connect";
import { listUsers } from "../../../application/apple-users";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscAuthArgs } from "../../../application/app-store-connect";

export const usersListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List App Store Connect team users and their roles (needs an Admin-role key)",
  },
  args: {
    ...ASC_AUTH_ARGS,
  },
  run: async ({ args }: { readonly args: AscAuthArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscContext(args);
        const users = yield* listUsers(session.ctx);
        yield* printHumanList(
          ["Email", "Name", "Roles", "All apps", "ID"],
          users.map((user) => [
            user.email ?? user.username ?? "—",
            [user.firstName, user.lastName].filter(Boolean).join(" ") || "—",
            user.roles.join(", ") || "—",
            user.allAppsVisible ? "yes" : "no",
            user.id,
          ]),
          "No team users found.",
        );
        return { items: users };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
