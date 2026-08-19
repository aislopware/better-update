import { Console, Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

import type { ChildProcessSpawner } from "effect/unstable/process";

import { createBrowserLoginServer } from "../lib/browser-login";
import { runExitCode } from "../lib/child-process";
import { promptPassword } from "../lib/prompts";
import { ApiClientService } from "../services/api-client";
import { AuthStore } from "../services/auth-store";
import { CliRuntime } from "../services/cli-runtime";
import { ConfigStore } from "../services/config-store";

const buildOpenBrowserCommand = (platform: NodeJS.Platform, url: string) => {
  if (platform === "darwin") {
    return ChildProcess.make("open", [url]);
  }
  if (platform === "win32") {
    return ChildProcess.make("cmd", ["/c", "start", "", url]);
  }
  return ChildProcess.make("xdg-open", [url]);
};

const openBrowser = (
  url: string,
): Effect.Effect<void, never, CliRuntime | ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const runtime = yield* CliRuntime;
    const command = buildOpenBrowserCommand(runtime.platform, url);

    const opened = yield* runExitCode(command).pipe(
      Effect.map((code) => code === 0),
      Effect.orElseSucceed(() => false),
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
      Effect.promise(async () => createBrowserLoginServer()),
      (server) => Effect.sync(server.stop),
    );

    const loginUrl = `${webUrl}/auth/cli-login?callbackUrl=${encodeURIComponent(loginServer.callbackUrl)}`;

    yield* Console.log("Opening browser for better-update login...");
    yield* Console.log("");
    yield* openBrowser(loginUrl);

    const oneTimeToken = yield* loginServer.waitForToken;
    const apiClientService = yield* ApiClientService;
    const sessionToken = yield* apiClientService.exchangeOneTimeToken(oneTimeToken);
    yield* authStore.saveToken(sessionToken);
    yield* Console.log("");
    yield* Console.log("Logged in successfully. Token saved to ~/.better-update/auth.json");
  }),
);

const manualLogin = Effect.gen(function* () {
  yield* Console.log("Log in to better-update by pasting a session token");
  yield* Console.log("");

  const token = yield* promptPassword("Paste your session token:");
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
