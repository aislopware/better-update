import { defineCommand } from "citty";
import { Console, Effect } from "effect";

import {
  ensureAndroidCredentials,
  ensureIosCredentials,
} from "../../application/credentials-interactive";
import {
  rebindAndroidKeystore,
  rebindIosBundle,
  showAndroidBinding,
  showIosBinding,
} from "../../application/credentials-rebind";
import { runEffect } from "../../lib/citty-effect";
import { extractProjectId, readAppMeta, readExpoConfig } from "../../lib/expo-config";
import { printHuman } from "../../lib/output";
import { promptSelect, promptText } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type { IosDistribution } from "../../lib/build-profile";
import type { ApiClient } from "../../services/api-client";

interface ConfigureAndroidArgs {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly applicationIdentifier: string;
  readonly rebind: boolean;
}

const configureAndroid = (args: ConfigureAndroidArgs) =>
  Effect.gen(function* () {
    const input = {
      projectId: args.projectId,
      applicationIdentifier: args.applicationIdentifier,
    };
    if (args.rebind) {
      yield* rebindAndroidKeystore(args.api, input);
      yield* Console.log("");
      yield* Console.log("Updated binding:");
      yield* showAndroidBinding(args.api, input);
      return;
    }
    yield* Console.log(`Configuring Android credentials for ${args.applicationIdentifier}...`);
    yield* ensureAndroidCredentials(args.api, input, { freezeCredentials: false });
    yield* Console.log("");
    yield* Console.log("Current Android binding:");
    yield* showAndroidBinding(args.api, input);
    yield* printHuman("");
    yield* printHuman("Run with --rebind to switch keystore on the default group.");
  });

interface ConfigureIosArgs {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distribution: IosDistribution;
  readonly rebind: boolean;
}

const configureIos = (args: ConfigureIosArgs) =>
  Effect.gen(function* () {
    const input = {
      projectId: args.projectId,
      bundleIdentifier: args.bundleIdentifier,
      distribution: args.distribution,
    };
    if (args.rebind) {
      yield* rebindIosBundle(args.api, input);
      yield* Console.log("");
      yield* Console.log("Updated binding:");
      yield* showIosBinding(args.api, input);
      return;
    }
    yield* Console.log(
      `Configuring iOS credentials for ${args.bundleIdentifier} (${args.distribution})...`,
    );
    yield* ensureIosCredentials(args.api, input, { freezeCredentials: false });
    yield* Console.log("");
    yield* Console.log("Current iOS binding:");
    yield* showIosBinding(args.api, input);
    yield* printHuman("");
    yield* printHuman("Run with --rebind to switch certificate, profile, or ASC key.");
  });

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
    rebind: {
      type: "boolean",
      description: "Re-bind credentials on an already-configured app/bundle (swap keystore/cert)",
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
          const bundleIdentifier =
            args.bundle ?? iosMeta.bundleId ?? (yield* promptText("iOS bundle identifier"));
          yield* configureIos({
            api,
            projectId,
            bundleIdentifier,
            distribution: args.distribution as IosDistribution,
            rebind: args.rebind ?? false,
          });
          return;
        }
        const androidMeta = yield* readAppMeta(expo, "android");
        const applicationIdentifier =
          args["android-package"] ??
          androidMeta.androidPackage ??
          (yield* promptText("Android application identifier"));
        yield* configureAndroid({
          api,
          projectId,
          applicationIdentifier,
          rebind: args.rebind ?? false,
        });
      }),
    ),
});
