import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { uploadScreenshots } from "../../../application/app-store-media";
import { resolveScreenshotDisplayType } from "../../../lib/asc-display-types";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman, printHumanTable } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface ScreenshotsUploadArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly locale?: string | undefined;
  readonly device?: string | undefined;
  readonly dir?: string | undefined;
  readonly file?: string | undefined;
  readonly replace: boolean;
}

export const screenshotsUploadCommand = defineCommand({
  meta: {
    name: "upload",
    description: "Upload screenshots to a locale + device set on the editable version",
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
      description: "Device class, e.g. APP_IPHONE_67 or iphone-67 (required)",
    },
    dir: { type: "string", description: "A directory of images, uploaded in sorted name order" },
    file: { type: "string", description: "A single image to upload (use instead of/with --dir)" },
    replace: {
      type: "boolean",
      default: false,
      description: "Delete the set's existing screenshots before uploading",
    },
  },
  run: async ({ args }: { readonly args: ScreenshotsUploadArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const locale = args.locale?.trim();
        if (locale === undefined || locale.length === 0) {
          return yield* new InvalidArgumentError({ message: "--locale is required, e.g. en-US." });
        }
        if (args.device === undefined || args.device.trim().length === 0) {
          return yield* new InvalidArgumentError({
            message: "--device is required, e.g. APP_IPHONE_67 or iphone-67.",
          });
        }
        const displayType = yield* resolveScreenshotDisplayType(args.device);
        // Treat an empty --dir / --file as absent so the "no images" guard fires
        // cleanly instead of an empty path slipping past it (and, with --replace,
        // clearing the set before failing).
        const dir = args.dir?.trim();
        const file = args.file?.trim();
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* uploadScreenshots(session.ctx, session.appId, platform, {
          locale,
          displayType,
          replace: args.replace,
          ...compact({
            dir: dir !== undefined && dir.length > 0 ? dir : undefined,
            files: file !== undefined && file.length > 0 ? [file] : undefined,
          }),
        });
        yield* printHumanTable(
          ["File", "State", "Id"],
          result.uploaded.map((shot) => [shot.fileName, shot.state, shot.id]),
        );
        yield* printHuman(
          `Uploaded ${result.uploaded.length} screenshot(s) to ${result.locale} / ${result.device}${
            result.cleared > 0 ? ` (replaced ${result.cleared})` : ""
          }.`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
