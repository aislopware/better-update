import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { clearScreenshots } from "../../../application/app-store-media";
import { resolveScreenshotDisplayType } from "../../../lib/asc-display-types";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const screenshotsClearCommand = Command.make(
  "clear",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    locale: Flag.String("locale").pipe(Flag.withDescription("Locale, e.g. en-US")),
    device: Flag.String("device").pipe(
      Flag.withDescription(
        "Only clear this device's set (e.g. iphone-67); omit to clear every set",
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const locale = args.locale.trim();
      // Distinguish an absent --device (clear every set) from a present-but-empty
      // one (a footgun: `--device "$DEV"` with $DEV unset would wipe all sets).
      if (args.device?.trim().length === 0) {
        return yield* new InvalidArgumentError({
          message:
            "--device was empty. Omit it to clear every set, or pass a device like iphone-67.",
        });
      }
      const displayType =
        args.device === undefined ? undefined : yield* resolveScreenshotDisplayType(args.device);
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const result = yield* clearScreenshots(session.ctx, session.appId, platform, {
        locale,
        ...compact({ displayType }),
      });
      yield* printHuman(
        `Deleted ${result.deleted} screenshot(s) across ${result.sets} set(s) for ${result.locale}.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Delete screenshots from a locale's set(s) on the editable version"),
);
