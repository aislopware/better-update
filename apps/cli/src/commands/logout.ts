import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { AppleSessionStore } from "../services/apple-session-store";
import { AuthStore } from "../services/auth-store";

export const logoutCommand = defineCommand({
  meta: { name: "logout", description: "Remove the stored auth token" },
  args: {
    all: {
      type: "boolean",
      description: "Also clear cached Apple Developer session (cookies)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const authStore = yield* AuthStore;
        yield* authStore.clearToken;
        yield* Console.log("Logged out. Auth token removed.");
        if (args.all) {
          const appleStore = yield* AppleSessionStore;
          yield* appleStore.clearSession;
          yield* Console.log("Cleared Apple Developer session.");
        }
      }),
    ),
});
