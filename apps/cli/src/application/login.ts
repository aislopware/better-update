import { Command } from "@effect/platform";
import { Console, Effect } from "effect";

import type { CommandExecutor } from "@effect/platform";

import { createBrowserLoginServer } from "../lib/browser-login";
import { promptPassword } from "../lib/prompts";
import { AuthStore } from "../services/auth-store";
import { CliRuntime } from "../services/cli-runtime";
import { ConfigStore } from "../services/config-store";

const buildOpenBrowserCommand = (platform: NodeJS.Platform, url: string) => {
  if (platform === "darwin") {
    return Command.make("open", url);
  }
  if (platform === "win32") {
    return Command.make("cmd", "/c", "start", "", url);
  }
  return Command.make("xdg-open", url);
};

const openBrowser = (
  url: string,
): Effect.Effect<void, never, CliRuntime | CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const command = buildOpenBrowserCommand(runtime.platform, url);

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
    const webUrl = yield* configStore.getWebUrl;

    const loginServer = yield* Effect.acquireRelease(
      Effect.sync(createBrowserLoginServer),
      (server) => Effect.sync(server.stop),
    );

    const loginUrl = `${webUrl}/auth/cli-login?callbackUrl=${encodeURIComponent(loginServer.callbackUrl)}`;

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

  const token = yield* Effect.promise(async () =>
    promptPassword("Paste your API key (from dashboard > API Keys):"),
  );
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
