import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import {
  ensureAndroidCredentials,
  ensureIosCredentials,
} from "../../application/credentials-interactive";
import { runEffect } from "../../lib/citty-effect";
import { extractProjectId, readAppMeta, readExpoConfig } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { promptSelect, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type { IosDistribution } from "../../lib/build-profile";

export const configureCommand = defineCommand({
  meta: {
    name: "configure",
    description: "Interactive wizard to configure signing credentials (outside a build run)",
  },
  args: {
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "Skip the platform prompt",
    },
    bundle: { type: "string", description: "iOS bundle identifier (defaults to app.json)" },
    "android-package": {
      type: "string",
      description: "Android application identifier (defaults to app.json)",
    },
    distribution: {
      type: "enum",
      options: ["ad-hoc", "app-store", "development", "enterprise"],
      default: "ad-hoc",
      description: "iOS distribution type",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const root = yield* runtime.cwd;
        const expo = yield* readExpoConfig(root);
        const projectId = yield* extractProjectId(expo);

        const platform =
          args.platform ??
          (yield* promptSelect<"ios" | "android">("Configure credentials for which platform?", [
            { value: "ios", label: "iOS" },
            { value: "android", label: "Android" },
          ]));

        if (platform === "ios") {
          const iosMeta = yield* readAppMeta(expo, "ios");
          const bundle =
            args.bundle ?? iosMeta.bundleId ?? (yield* promptText("iOS bundle identifier"));
          yield* Console.log(`Configuring iOS credentials for ${bundle} (${args.distribution})...`);
          yield* ensureIosCredentials(
            api,
            {
              projectId,
              bundleIdentifier: bundle,
              distribution: args.distribution as IosDistribution,
            },
            { freezeCredentials: false },
          );
          yield* printHuman("iOS credentials configured.");
          return;
        }
        const androidMeta = yield* readAppMeta(expo, "android");
        const applicationIdentifier =
          args["android-package"] ??
          androidMeta.androidPackage ??
          (yield* promptText("Android application identifier"));
        yield* Console.log(`Configuring Android credentials for ${applicationIdentifier}...`);
        yield* ensureAndroidCredentials(
          api,
          { projectId, applicationIdentifier },
          { freezeCredentials: false },
        );
        yield* printHuman("Android credentials configured.");
      }),
    ),
});
