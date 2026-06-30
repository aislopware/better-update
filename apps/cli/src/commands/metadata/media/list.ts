import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { listMedia } from "../../../application/app-store-media";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanList } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface MediaListArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly locale?: string | undefined;
}

export const mediaListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the editable version's screenshot + preview sets and their counts",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    locale: { type: "string", description: "Only show this locale (e.g. en-US); default: all" },
  },
  run: async ({ args }: { readonly args: MediaListArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        // Trim and treat an empty --locale as "all" (an unset `--locale "$LOC"`
        // would otherwise match no localization and report nothing found).
        const locale = args.locale?.trim();
        const localeFilter = locale === undefined || locale.length === 0 ? undefined : locale;
        const rows = yield* listMedia(session.ctx, session.appId, platform, localeFilter);
        yield* printHumanList(
          ["Locale", "Kind", "Device", "Count", "Set id"],
          rows.map((row) => [row.locale, row.kind, row.device, String(row.count), row.setId]),
          "No screenshot or preview sets found on the editable version.",
        );
        return { items: rows };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
