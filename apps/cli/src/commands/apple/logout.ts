import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";
import { AppleAuth } from "../../services/apple-auth";
import { AppleSessionStore } from "../../services/apple-session-store";

export const appleLogoutCommand = Command.make(
  "logout",
  {
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Log out every cached Apple account"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const auth = yield* AppleAuth;
      const store = yield* AppleSessionStore;
      const { active, accounts } = yield* store.listAccounts;
      if (args.all) {
        yield* auth.logoutAll;
        yield* printHuman(
          accounts.length === 0
            ? "No cached Apple sessions."
            : `Cleared ${accounts.length} cached Apple session(s).`,
        );
        return { loggedOut: accounts.length > 0, all: true, accounts };
      }
      if (active === null) {
        yield* printHuman(
          accounts.length === 0
            ? "No cached Apple session."
            : "No active Apple account. Use `better-update apple accounts switch` or `apple logout --all`.",
        );
        return { loggedOut: false, all: false, accounts };
      }
      yield* auth.logout;
      yield* printHuman(`Logged out ${active}.`);
      if (accounts.length > 1) {
        yield* printHuman(
          "Other cached accounts remain — switch via `better-update apple accounts switch`.",
        );
      }
      return { loggedOut: true, all: false, username: active };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Log out the active Apple account (cookies only; ASC API keys and other cached accounts unaffected)",
  ),
);
