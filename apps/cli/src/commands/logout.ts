import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { printHuman } from "../lib/output";
import { runCommand } from "../lib/run-command";
import { AppleSessionStore } from "../services/apple-session-store";
import { AuthStore } from "../services/auth-store";

export const logoutCommand = Command.make(
  "logout",
  {
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("Also clear all cached Apple Developer sessions (cookies)"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const authStore = yield* AuthStore;
      yield* authStore.clearToken;
      yield* printHuman("Logged out. Auth token removed.");
      const clearedApple = args.all;
      if (clearedApple) {
        const appleStore = yield* AppleSessionStore;
        yield* appleStore.clearAllSessions;
        yield* printHuman("Cleared Apple Developer sessions.");
      }
      return { loggedOut: true, clearedAppleSession: clearedApple };
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Remove the stored auth token"));
