import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { listMedia } from "../../../application/app-store-media";
import { printHumanList } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const mediaListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    locale: Flag.String("locale").pipe(
      Flag.withDescription("Only show this locale (e.g. en-US); default: all"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("List the editable version's screenshot + preview sets and their counts"),
);
