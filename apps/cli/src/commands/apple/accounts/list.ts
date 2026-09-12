import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";
import { AppleSessionStore } from "../../../services/apple-session-store";

export const accountsListCommand = Command.make(
  "list",
  {},
  Effect.fn(
    function* () {
      const store = yield* AppleSessionStore;
      const { active, accounts } = yield* store.listAccounts;
      if (accounts.length === 0) {
        yield* printHuman("No cached Apple accounts. Run `better-update apple login` to add one.");
        return { active, accounts };
      }
      yield* Effect.forEach(
        accounts,
        (account) => printHuman(account === active ? `* ${account} (active)` : `  ${account}`),
        { discard: true },
      );
      return { active, accounts };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List Apple accounts with a cached session"));
