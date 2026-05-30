import { defineCommand } from "citty";
import { Effect } from "effect";

import { regenerateProvisioningProfile } from "../../application/credentials-interactive";
import { runEffect } from "../../lib/citty-effect";
import { CredentialValidationError, MissingCredentialsError } from "../../lib/exit-codes";
import { printHuman, printHumanKeyValue } from "../../lib/output";
import { readAppMetaOptional, readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";
import { CliRuntime } from "../../services/cli-runtime";

import type { IosDistribution } from "../../lib/build-profile";
import type { ApiClient } from "../../services/api-client";

const REGENERATE_EXIT_EXTRAS = {
  CredentialValidationError: 2,
  MissingCredentialsError: 5,
} as const;

const distributionTypeToDistribution = (value: string): IosDistribution => {
  switch (value) {
    case "AD_HOC": {
      return "ad-hoc";
    }
    case "DEVELOPMENT": {
      return "development";
    }
    case "ENTERPRISE": {
      return "enterprise";
    }
    default: {
      return "app-store";
    }
  }
};

const regenerateOne = (
  api: ApiClient,
  projectId: string,
  bundleIdentifier: string,
  distribution: IosDistribution,
) =>
  Effect.gen(function* () {
    const created = yield* regenerateProvisioningProfile(api, {
      projectId,
      bundleIdentifier,
      distribution,
    });
    yield* printHumanKeyValue([
      ["Bundle", bundleIdentifier],
      ["Distribution", distribution],
      ["Profile ID", created.id],
      ["Profile name", created.profileName ?? "-"],
      ["Valid until", created.validUntil ?? "-"],
    ]);
    return { bundleIdentifier, distribution, profile: created };
  });

const regenerateAllForProject = (api: ApiClient, projectId: string) =>
  Effect.gen(function* () {
    const configs = yield* api.iosBundleConfigurations.list({ path: { projectId } });
    if (configs.items.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No iOS bundle configurations found for this project.",
        hint: "Run `better-update credentials configure --platform ios` to create one first.",
      });
    }
    yield* printHuman(
      `Regenerating ${String(configs.items.length)} provisioning profile(s) for this project...`,
    );
    type RegenerationResult = Effect.Effect.Success<ReturnType<typeof regenerateOne>>;
    const regenerated: RegenerationResult[] = [];
    for (const config of configs.items) {
      const distribution = distributionTypeToDistribution(config.distributionType);
      yield* printHuman("");
      const one = yield* regenerateOne(api, projectId, config.bundleIdentifier, distribution);
      regenerated.push(one);
    }
    return { regenerated };
  });

export const regenerateProfileCommand = defineCommand({
  meta: {
    name: "regenerate-profile",
    description:
      "Re-issue an iOS provisioning profile via the App Store Connect API (after device roster changes or expiry)",
  },
  args: {
    bundle: { type: "string", description: "iOS bundle identifier (defaults to app.json)" },
    distribution: {
      type: "enum",
      options: ["ad-hoc", "app-store", "development", "enterprise"],
      default: "ad-hoc",
      description: "Distribution type of the bundle configuration",
    },
    all: {
      type: "boolean",
      description: "Regenerate profiles for every iOS bundle configuration on this project",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const runtime = yield* CliRuntime;
        const projectRoot = yield* runtime.cwd;
        const projectId = yield* readProjectId;

        if (args.all === true) {
          return yield* regenerateAllForProject(api, projectId);
        }

        const iosMeta = yield* readAppMetaOptional(projectRoot, "ios");
        const bundleIdentifier = args.bundle ?? iosMeta.bundleId;
        if (bundleIdentifier === undefined || bundleIdentifier.length === 0) {
          return yield* new CredentialValidationError({
            message:
              "Missing --bundle and no ios.bundleIdentifier available (pass --bundle for a non-Expo project).",
          });
        }

        const one = yield* regenerateOne(api, projectId, bundleIdentifier, args.distribution);
        return { regenerated: [one] };
      }),
      { exits: REGENERATE_EXIT_EXTRAS, json: "value" },
    ),
});
