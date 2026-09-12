import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { localizeVersion } from "../../../application/app-store-versions";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const versionLocalizeCommand = Command.make(
  "localize",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    locale: Flag.String("locale").pipe(Flag.withDescription("Locale to set, e.g. en-US")),
    "whats-new": Flag.String("whats-new").pipe(
      Flag.withDescription("Release notes ('What's New in This Version')"),
      optionalFlag,
    ),
    description: Flag.String("description").pipe(
      Flag.withDescription("App description"),
      optionalFlag,
    ),
    keywords: Flag.String("keywords").pipe(
      Flag.withDescription("Comma-separated keywords"),
      optionalFlag,
    ),
    "promotional-text": Flag.String("promotional-text").pipe(
      Flag.withDescription("Promotional text"),
      optionalFlag,
    ),
    "marketing-url": Flag.String("marketing-url").pipe(
      Flag.withDescription("Marketing URL"),
      optionalFlag,
    ),
    "support-url": Flag.String("support-url").pipe(
      Flag.withDescription("Support URL"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Set per-locale App Store metadata (release notes, description, keywords) on the editable version",
  ),
);
