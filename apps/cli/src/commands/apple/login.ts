import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import { AppleAuth } from "../../services/apple-auth";

const LOGIN_EXIT_EXTRAS = {
  AppleAuthError: 4,
  InteractiveProhibitedError: 4,
} as const;

export const appleLoginCommand = defineCommand({
  meta: {
    name: "login",
    description: "Log in to your Apple Developer account (used to issue iOS certificates)",
  },
  args: {
    username: {
      type: "string",
      description: "Pre-fill the Apple ID prompt (defaults to last-used Apple ID)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const auth = yield* AppleAuth;
        const session = yield* auth.ensureLoggedIn(
          args.username === undefined ? {} : { username: args.username },
        );
        yield* Console.log(
          `Logged in as ${session.username}. Team: ${session.teamName ?? session.teamId} (${session.teamId}).`,
        );
      }),
      LOGIN_EXIT_EXTRAS,
    ),
});
