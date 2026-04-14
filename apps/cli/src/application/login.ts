import { Prompt } from "@effect/cli";
import { Command, CommandExecutor } from "@effect/platform";
import { Console, Effect, Redacted } from "effect";

import { createBrowserLoginServer } from "../lib/browser-login";
import { AuthStore } from "../services/auth-store";
import { CliRuntime } from "../services/cli-runtime";
import { ConfigStore } from "../services/config-store";

const tokenPrompt = Prompt.password({
  message: "Paste your API key (from dashboard > API Keys):",
});

const openBrowser = (
  url: string,
): Effect.Effect<void, never, CliRuntime | CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const command =
      runtime.platform === "darwin"
        ? Command.make("open", url)
        : runtime.platform === "win32"
          ? Command.make("cmd", "/c", "start", "", url)
          : Command.make("xdg-open", url);

    const opened = yield* Command.exitCode(command).pipe(
      Effect.map((code) => code === 0),
      Effect.catchAll(() => Effect.succeed(false)),
    );

    if (!opened) {
      yield* Console.log(`Open this URL manually:\n${url}`);
    }
  });

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

export const runLogin = (options: { readonly manualApiKey: boolean }) =>
  Effect.gen(function* () {
    if (options.manualApiKey) {
      yield* manualLogin;
      return;
    }

    yield* browserLogin;
  });
