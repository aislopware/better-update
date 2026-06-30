import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { uploadPreview } from "../../../application/app-store-media";
import { resolvePreviewType } from "../../../lib/asc-display-types";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface PreviewsUploadArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly locale?: string | undefined;
  readonly device?: string | undefined;
  readonly file?: string | undefined;
  readonly "frame-time"?: string | undefined;
}

export const previewsUploadCommand = defineCommand({
  meta: {
    name: "upload",
    description:
      "Upload a preview video to a locale + device set on the editable version (waits for Apple's transcode)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    locale: { type: "string", description: "Locale, e.g. en-US (required)" },
    device: { type: "string", description: "Device class, e.g. IPHONE_67 or iphone-67 (required)" },
    file: { type: "string", description: "Path to the video file, MP4 or MOV (required)" },
    "frame-time": {
      type: "string",
      description: 'Poster-frame time code "HH:MM:SS:FF", e.g. 00:00:05:01',
    },
  },
  run: async ({ args }: { readonly args: PreviewsUploadArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const locale = args.locale?.trim();
        if (locale === undefined || locale.length === 0) {
          return yield* new InvalidArgumentError({ message: "--locale is required, e.g. en-US." });
        }
        if (args.device === undefined || args.device.trim().length === 0) {
          return yield* new InvalidArgumentError({
            message: "--device is required, e.g. IPHONE_67 or iphone-67.",
          });
        }
        const file = args.file?.trim();
        if (file === undefined || file.length === 0) {
          return yield* new InvalidArgumentError({
            message: "--file is required (an MP4/MOV video).",
          });
        }
        const previewType = yield* resolvePreviewType(args.device);
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* uploadPreview(session.ctx, session.appId, platform, {
          locale,
          previewType,
          filePath: file,
          ...compact({ frameTime: args["frame-time"] }),
        });
        yield* printHuman(
          `Uploaded preview ${result.fileName} to ${result.locale} / ${result.device} (state: ${result.state}).`,
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
