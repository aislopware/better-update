import { Command } from "@effect/cli";
import { Console, Effect } from "effect";

import { AuthStore } from "../services/auth-store";

export const logoutCommand = Command.make("logout", {}, () =>
  Effect.gen(function* () {
    const authStore = yield* AuthStore;
    yield* authStore.clearToken;
    yield* Console.log("Logged out. Auth token removed.");
  }),
);
