import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
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
          yield* Console.log("Not logged in to Apple. Run `better-update apple login` to start.");
          return;
        }
        yield* Console.log(`Apple ID: ${session.username}`);
        yield* Console.log(`Team:     ${session.teamName ?? "(unknown)"} (${session.teamId})`);
        if (session.providerId !== undefined) {
          yield* Console.log(`Provider: ${String(session.providerId)}`);
        }
      }),
    ),
});
