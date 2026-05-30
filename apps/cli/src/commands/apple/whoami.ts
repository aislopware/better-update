import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { printHuman } from "../../lib/output";
import { AppleAuth } from "../../services/apple-auth";

export const appleWhoamiCommand = defineCommand({
  meta: {
    name: "whoami",
    description: "Show the currently-cached Apple Developer session",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* AppleAuth;
        const session = yield* auth.whoami;
        if (session === null) {
          yield* printHuman("Not logged in to Apple. Run `better-update apple login` to start.");
          return { loggedIn: false, session: null };
        }
        yield* printHuman(`Apple ID: ${session.username}`);
        yield* printHuman(`Team:     ${session.teamName ?? "(unknown)"} (${session.teamId})`);
        if (session.providerId !== undefined) {
          yield* printHuman(`Provider: ${String(session.providerId)}`);
        }
        return { loggedIn: true, session };
      }),
      { json: "value" },
    ),
});
