import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";
import { AppleSessionStore } from "../../../services/apple-session-store";

export const accountsListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List Apple accounts with a cached session",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const store = yield* AppleSessionStore;
        const { active, accounts } = yield* store.listAccounts;
        if (accounts.length === 0) {
          yield* printHuman(
            "No cached Apple accounts. Run `better-update apple login` to add one.",
          );
          return { active, accounts };
        }
        yield* Effect.forEach(
          accounts,
          (account) => printHuman(account === active ? `* ${account} (active)` : `  ${account}`),
          { discard: true },
        );
        return { active, accounts };
      }),
      { json: "value" },
    ),
});
