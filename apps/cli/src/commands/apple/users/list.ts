import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, openAscContext } from "../../../application/app-store-connect";
import { listUsers } from "../../../application/apple-users";
import { printHumanList } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const usersListCommand = Command.make(
  "list",
  {
    ...ASC_AUTH_ARGS,
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "List App Store Connect team users and their roles (needs an Admin-role key)",
  ),
);
