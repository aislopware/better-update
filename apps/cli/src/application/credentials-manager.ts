import { Console, Effect } from "effect";

import { extractProjectId, readAppMeta, readExpoConfig } from "../lib/expo-config";
import { promptSelect } from "../lib/prompts";
import { apiClient } from "../services/api-client";
import { CliRuntime } from "../services/cli-runtime";
import { androidMenu } from "./credentials-manager-android";
import { iosMenu } from "./credentials-manager-ios";
import { announce, EXIT, safePrompt } from "./credentials-manager-shared";

import type { MenuEffect, WizardContext } from "./credentials-manager-shared";

const mainMenu = (ctx: WizardContext): MenuEffect =>
  Effect.gen(function* () {
    yield* announce("Main");
    const choice = yield* safePrompt(
      promptSelect<string>("Pick a platform", [
        { value: "ios", label: "iOS" },
        { value: "android", label: "Android" },
        { value: EXIT, label: "Exit" },
      ]),
    );
    if (choice === EXIT) {
      return;
    }
    if (choice === "ios") {
      yield* iosMenu(ctx);
    } else if (choice === "android") {
      yield* androidMenu(ctx);
    }
    yield* mainMenu(ctx);
  });

export const runCredentialsManager = Effect.gen(function* () {
  const api = yield* apiClient;
  const runtime = yield* CliRuntime;
  const cwd = yield* runtime.cwd;

  const expoConfig = yield* readExpoConfig(cwd);
  const projectId = yield* extractProjectId(expoConfig);
  const emptyMeta = {
    bundleId: undefined,
    androidPackage: undefined,
    appVersion: undefined,
    buildNumber: undefined,
    rawRuntimeVersion: undefined,
  } as const;
  const iosMeta = yield* readAppMeta(expoConfig, "ios").pipe(Effect.orElseSucceed(() => emptyMeta));
  const androidMeta = yield* readAppMeta(expoConfig, "android").pipe(
    Effect.orElseSucceed(() => emptyMeta),
  );

  const ctx: WizardContext = {
    api,
    projectId,
    iosBundleId: iosMeta.bundleId,
    androidPackage: androidMeta.androidPackage,
  };

  yield* Console.log("better-update credentials manager");
  yield* Console.log(`Project: ${projectId}`);

  yield* mainMenu(ctx);

  yield* Console.log("Bye.");
});
