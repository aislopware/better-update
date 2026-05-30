import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { printHuman } from "../lib/output";
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
        yield* printHuman("Logged out. Auth token removed.");
        const clearedApple = args.all ?? false;
        if (clearedApple) {
          const appleStore = yield* AppleSessionStore;
          yield* appleStore.clearSession;
          yield* printHuman("Cleared Apple Developer session.");
        }
        return { loggedOut: true, clearedAppleSession: clearedApple };
      }),
      { json: "value" },
    ),
});
