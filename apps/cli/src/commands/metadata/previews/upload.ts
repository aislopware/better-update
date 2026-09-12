import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { uploadPreview } from "../../../application/app-store-media";
import { resolvePreviewType } from "../../../lib/asc-display-types";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const previewsUploadCommand = Command.make(
  "upload",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    locale: Flag.String("locale").pipe(Flag.withDescription("Locale, e.g. en-US")),
    device: Flag.String("device").pipe(
      Flag.withDescription("Device class, e.g. IPHONE_67 or iphone-67"),
    ),
    file: Flag.String("file").pipe(Flag.withDescription("Path to the video file, MP4 or MOV")),
    "frame-time": Flag.String("frame-time").pipe(
      Flag.withDescription('Poster-frame time code "HH:MM:SS:FF", e.g. 00:00:05:01'),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const locale = args.locale.trim();
      const file = args.file.trim();
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Upload a preview video to a locale + device set on the editable version (waits for Apple's transcode)",
  ),
);
