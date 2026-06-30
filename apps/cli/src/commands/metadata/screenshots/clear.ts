import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { clearScreenshots } from "../../../application/app-store-media";
import { resolveScreenshotDisplayType } from "../../../lib/asc-display-types";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface ScreenshotsClearArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly locale?: string | undefined;
  readonly device?: string | undefined;
}

export const screenshotsClearCommand = defineCommand({
  meta: {
    name: "clear",
    description: "Delete screenshots from a locale's set(s) on the editable version",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    locale: { type: "string", description: "Locale, e.g. en-US (required)" },
    device: {
      type: "string",
      description: "Only clear this device's set (e.g. iphone-67); omit to clear every set",
    },
  },
  run: async ({ args }: { readonly args: ScreenshotsClearArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const locale = args.locale?.trim();
        if (locale === undefined || locale.length === 0) {
          return yield* new InvalidArgumentError({ message: "--locale is required, e.g. en-US." });
        }
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
