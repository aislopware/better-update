import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { localizeVersion } from "../../../application/app-store-versions";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface VersionLocalizeArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly locale?: string | undefined;
  readonly "whats-new"?: string | undefined;
  readonly description?: string | undefined;
  readonly keywords?: string | undefined;
  readonly "promotional-text"?: string | undefined;
  readonly "marketing-url"?: string | undefined;
  readonly "support-url"?: string | undefined;
}

export const versionLocalizeCommand = defineCommand({
  meta: {
    name: "localize",
    description:
      "Set per-locale App Store metadata (release notes, description, keywords) on the editable version",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    locale: { type: "string", description: "Locale to set, e.g. en-US (required)" },
    "whats-new": { type: "string", description: "Release notes ('What's New in This Version')" },
    description: { type: "string", description: "App description" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    "promotional-text": { type: "string", description: "Promotional text" },
    "marketing-url": { type: "string", description: "Marketing URL" },
    "support-url": { type: "string", description: "Support URL" },
  },
  run: async ({ args }: { readonly args: VersionLocalizeArgs }) =>
    runEffect(
      Effect.gen(function* () {
        if (args.locale === undefined || args.locale.trim().length === 0) {
          return yield* new InvalidArgumentError({ message: "--locale is required, e.g. en-US." });
        }
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* localizeVersion(session.ctx, session.appId, platform, {
          locale: args.locale.trim(),
          ...compact({
            whatsNew: args["whats-new"],
            description: args.description,
            keywords: args.keywords,
            promotionalText: args["promotional-text"],
            marketingUrl: args["marketing-url"],
            supportUrl: args["support-url"],
          }),
        });
        yield* printHuman(
          `Updated ${result.locale} metadata (${result.fields.join(", ")}) on version ${result.versionId}.`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
