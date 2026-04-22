import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { AuthStore } from "../services/auth-store";

export const logoutCommand = defineCommand({
  meta: { name: "logout", description: "Remove the stored auth token" },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const authStore = yield* AuthStore;
        yield* authStore.clearToken;
        yield* Console.log("Logged out. Auth token removed.");
      }),
    ),
});
