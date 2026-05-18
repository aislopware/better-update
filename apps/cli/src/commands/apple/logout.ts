import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { AppleAuth } from "../../services/apple-auth";

export const appleLogoutCommand = defineCommand({
  meta: {
    name: "logout",
    description: "Clear the cached Apple Developer session (cookies only; ASC API keys unaffected)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* AppleAuth;
        yield* auth.logout;
        yield* Console.log("Cleared Apple Developer session.");
      }),
    ),
});
