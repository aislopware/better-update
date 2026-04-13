import { Command, Prompt } from "@effect/cli";
import { Console, Effect, Redacted } from "effect";

import { AuthStore } from "../services/auth-store";

const tokenPrompt = Prompt.password({
  message: "Paste your API key (from dashboard > API Keys)",
});

export const loginCommand = Command.make("login", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("Log in to better-update");
    yield* Console.log("Get your API key from the dashboard > API Keys page");
    yield* Console.log("");
    const token = Redacted.value(yield* tokenPrompt);
    const authStore = yield* AuthStore;
    yield* authStore.saveToken(token);
    yield* Console.log("");
    yield* Console.log("Logged in successfully. Token saved to ~/.better-update/auth.json");
  }),
);
