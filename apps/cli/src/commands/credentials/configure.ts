import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

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
import { IOS_DISTRIBUTION_TO_TYPE } from "../../lib/credentials-downloader";
import { MissingCredentialsError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { readAppMetaOptional, readProjectId } from "../../lib/project-link";
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
  readonly bindFcmGsa: string | undefined;
}

const bindAndroidFcmGsa = (
  api: ApiClient,
  input: {
    readonly projectId: string;
    readonly applicationIdentifier: string;
    readonly gsaKeyId: string;
  },
) =>
  Effect.gen(function* () {
    const apps = yield* api.androidApplicationIdentifiers.list({
      path: { projectId: input.projectId },
    });
    const app = apps.items.find((entry) => entry.packageName === input.applicationIdentifier);
    if (app === undefined) {
      return yield* new MissingCredentialsError({
        message: `No Android build credentials for ${input.applicationIdentifier}.`,
        hint: "Run `better-update credentials configure --platform android` (without --bind-fcm-gsa) first to create one.",
      });
    }
    const groups = yield* api.androidBuildCredentials.list({
      path: { applicationIdentifierId: app.id },
    });
    const group = groups.items.find((entry) => entry.isDefault) ?? groups.items.at(0);
    if (group === undefined) {
      return yield* new MissingCredentialsError({
        message: `No default Android build credentials group for ${input.applicationIdentifier}.`,
        hint: "Run `better-update credentials configure --platform android` (without --bind-fcm-gsa) first.",
      });
    }
    yield* api.androidBuildCredentials.update({
      path: { id: group.id },
      payload: { googleServiceAccountKeyForFcmV1Id: input.gsaKeyId },
    });
    yield* printHuman(`Bound FCM V1 GSA key ${input.gsaKeyId} to ${input.applicationIdentifier}.`);
    return undefined;
  });

const bindBundleResource = (
  api: ApiClient,
  input: {
    readonly projectId: string;
    readonly bundleIdentifier: string;
    readonly distribution: IosDistribution;
  },
  payload: { readonly applePushKeyId?: string; readonly ascApiKeyId?: string },
) =>
  Effect.gen(function* () {
    const distributionType = IOS_DISTRIBUTION_TO_TYPE[input.distribution];
    const list = yield* api.iosBundleConfigurations.list({
      path: { projectId: input.projectId },
    });
    const match = list.items.find(
      (item) =>
        item.bundleIdentifier === input.bundleIdentifier &&
        item.distributionType === distributionType,
    );
    if (match === undefined) {
      return yield* new MissingCredentialsError({
        message: `No iOS bundle configuration for ${input.bundleIdentifier} (${input.distribution}).`,
        hint: "Run credentials configure --platform ios (without --bind-*) once to create it.",
      });
    }
    yield* api.iosBundleConfigurations.update({
      path: { id: match.id },
      payload,
    });
    yield* printHuman(
      `Updated iOS bundle ${input.bundleIdentifier} (${input.distribution}) binding.`,
    );
    return undefined;
  });

const configureAndroid = (args: ConfigureAndroidArgs) =>
  Effect.gen(function* () {
    const input = {
      projectId: args.projectId,
      applicationIdentifier: args.applicationIdentifier,
    };
    if (args.bindFcmGsa !== undefined) {
      yield* bindAndroidFcmGsa(args.api, { ...input, gsaKeyId: args.bindFcmGsa });
      yield* printHuman("");
      yield* printHuman("Updated binding:");
      yield* showAndroidBinding(args.api, input);
      return;
    }
    if (args.rebind) {
      yield* rebindAndroidKeystore(args.api, input);
      yield* printHuman("");
      yield* printHuman("Updated binding:");
      yield* showAndroidBinding(args.api, input);
      return;
    }
    yield* printHuman(`Configuring Android credentials for ${args.applicationIdentifier}...`);
    yield* ensureAndroidCredentials(args.api, input, { freezeCredentials: false });
    yield* printHuman("");
    yield* printHuman("Current Android binding:");
    yield* showAndroidBinding(args.api, input);
    yield* printHuman("");
    yield* printHuman("Run with --rebind to switch keystore on the default group.");
    yield* printHuman(
      "Run with --bind-fcm-gsa <gsaKeyId> to bind a GSA key for FCM V1 push notifications.",
    );
  });

interface ConfigureIosArgs {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distribution: IosDistribution;
  readonly rebind: boolean;
  readonly bindPushKey: string | undefined;
  readonly bindAscKey: string | undefined;
}

const configureIos = (args: ConfigureIosArgs) =>
  Effect.gen(function* () {
    const input = {
      projectId: args.projectId,
      bundleIdentifier: args.bundleIdentifier,
      distribution: args.distribution,
    };
    if (args.bindPushKey !== undefined || args.bindAscKey !== undefined) {
      yield* bindBundleResource(
        args.api,
        input,
        compact({ applePushKeyId: args.bindPushKey, ascApiKeyId: args.bindAscKey }),
      );
      yield* printHuman("");
      yield* printHuman("Updated binding:");
      yield* showIosBinding(args.api, input);
      return;
    }
    if (args.rebind) {
      yield* rebindIosBundle(args.api, input);
      yield* printHuman("");
      yield* printHuman("Updated binding:");
      yield* showIosBinding(args.api, input);
      return;
    }
    yield* printHuman(
      `Configuring iOS credentials for ${args.bundleIdentifier} (${args.distribution})...`,
    );
    yield* ensureIosCredentials(args.api, input, { freezeCredentials: false });
    yield* printHuman("");
    yield* printHuman("Current iOS binding:");
    yield* showIosBinding(args.api, input);
    yield* printHuman("");
    yield* printHuman("Run with --rebind to switch certificate, profile, or ASC key.");
    yield* printHuman(
      "Run with --bind-push-key <id> / --bind-asc-key <id> to update a single binding.",
    );
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
    "bind-push-key": {
      type: "string",
      description: "iOS only: bind an existing push key by ID to the bundle config",
    },
    "bind-asc-key": {
      type: "string",
      description: "iOS only: bind an existing ASC API key by ID to the bundle config",
    },
    "bind-fcm-gsa": {
      type: "string",
      description:
        "Android only: bind an existing GSA key by ID to FCM V1 push notifications on the default credentials group",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const root = yield* runtime.cwd;
        const projectId = yield* readProjectId;

        const platform =
          args.platform ??
          (yield* promptSelect<"ios" | "android">("Configure credentials for which platform?", [
            { value: "ios", label: "iOS" },
            { value: "android", label: "Android" },
          ]));

        if (platform === "ios") {
          const iosMeta = yield* readAppMetaOptional(root, "ios");
          const bundleIdentifier =
            args.bundle ?? iosMeta.bundleId ?? (yield* promptText("iOS bundle identifier"));
          yield* configureIos({
            api,
            projectId,
            bundleIdentifier,
            distribution: args.distribution as IosDistribution,
            rebind: args.rebind ?? false,
            bindPushKey: args["bind-push-key"],
            bindAscKey: args["bind-asc-key"],
          });
          return {
            platform: "ios" as const,
            projectId,
            bundleIdentifier,
            distribution: args.distribution,
          };
        }
        const androidMeta = yield* readAppMetaOptional(root, "android");
        const applicationIdentifier =
          args["android-package"] ??
          androidMeta.androidPackage ??
          (yield* promptText("Android application identifier"));
        yield* configureAndroid({
          api,
          projectId,
          applicationIdentifier,
          rebind: args.rebind ?? false,
          bindFcmGsa: args["bind-fcm-gsa"],
        });
        return { platform: "android" as const, projectId, applicationIdentifier };
      }),
      { json: "value" },
    ),
});
