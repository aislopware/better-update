import process from "node:process";

import { Command as CliCommand, Options, Prompt } from "@effect/cli";
import { Command } from "@effect/platform";
import { Console, Effect, Exit, Redacted } from "effect";

import { createBrowserLoginServer } from "../lib/browser-login";
import { AuthStore } from "../services/auth-store";
import { ConfigStore } from "../services/config-store";

const manualApiKey = Options.boolean("api-key");

const tokenPrompt = Prompt.password({
  message: "Paste your API key (from dashboard > API Keys):",
});

const browserCommandFor = (url: string) => {
  switch (process.platform) {
    case "darwin":
      return Command.make("open", url);
    case "win32":
      return Command.make("cmd", "/c", "start", "", url);
    default:
      return Command.make("xdg-open", url);
  }
};

const openBrowser = (url: string) =>
  Command.exitCode(browserCommandFor(url)).pipe(
    Effect.map((code) => code === 0),
    Effect.catchAll(() => Effect.succeed(false)),
    Effect.flatMap((opened) =>
      opened ? Effect.void : Console.log(`Open this URL manually:\n${url}`),
    ),
  );

const browserLogin = Effect.scoped(
  Effect.gen(function* () {
    const configStore = yield* ConfigStore;
    const authStore = yield* AuthStore;
    const dashboardUrl = yield* configStore.getDashboardUrl;

    const loginServer = yield* Effect.acquireRelease(
      Effect.sync(createBrowserLoginServer),
      (server) => Effect.sync(server.stop),
    );

    const loginUrl = `${dashboardUrl}/cli-login?callbackUrl=${encodeURIComponent(loginServer.callbackUrl)}`;

    yield* Console.log("Opening browser for better-update login...");
    yield* Console.log("");
    yield* openBrowser(loginUrl);

    const token = yield* loginServer.waitForToken;
    yield* authStore.saveToken(token);
    yield* Console.log("");
    yield* Console.log("Logged in successfully. Token saved to ~/.better-update/auth.json");
  }),
);

const manualLogin = Effect.gen(function* () {
  yield* Console.log("Log in to better-update with an existing API key");
  yield* Console.log("Get your API key from the dashboard > API Keys page");
  yield* Console.log("");

  const token = Redacted.value(yield* tokenPrompt);
  const authStore = yield* AuthStore;
  yield* authStore.saveToken(token);
  yield* Console.log("");
  yield* Console.log("Logged in successfully. Token saved to ~/.better-update/auth.json");
});

const loginFailed = (error: unknown): Effect.Effect<void> =>
  Console.error(error instanceof Error ? error.message : String(error)).pipe(
    Effect.zipRight(
      Effect.sync(() => {
        process.exitCode = 1;
      }),
    ),
  );

export const loginCommand = CliCommand.make("login", { manualApiKey }, (opts) =>
  (opts.manualApiKey ? manualLogin : browserLogin).pipe(
    Effect.exit,
    Effect.flatMap((exit) => (Exit.isSuccess(exit) ? Effect.void : loginFailed(exit.cause))),
  ),
);
