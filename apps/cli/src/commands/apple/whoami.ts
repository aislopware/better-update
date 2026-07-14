import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { AppleAuth } from "../../services/apple-auth";
import { AppleSessionStore } from "../../services/apple-session-store";

export const appleWhoamiCommand = defineCommand({
  meta: {
    name: "whoami",
    description: "Show the currently-active Apple Developer session",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* AppleAuth;
        const store = yield* AppleSessionStore;
        const { accounts } = yield* store.listAccounts;
        const session = yield* auth.whoami;
        if (session === null) {
          yield* printHuman(
            accounts.length === 0
              ? "Not logged in to Apple. Run `better-update apple login` to start."
              : "No active Apple session. Switch to a cached account via `better-update apple accounts switch`.",
          );
          return { loggedIn: false, session: null, accounts };
        }
        yield* printHuman(`Apple ID: ${session.username}`);
        yield* printHuman(`Team:     ${session.teamName ?? "(unknown)"} (${session.teamId})`);
        if (session.providerId !== undefined) {
          yield* printHuman(`Provider: ${String(session.providerId)}`);
        }
        if (accounts.length > 1) {
          yield* printHuman(
            `Accounts: ${accounts.length} cached — switch via \`better-update apple accounts switch\`.`,
          );
        }
        return { loggedIn: true, session, accounts };
      }),
      { json: "value" },
    ),
});
