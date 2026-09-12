import { compact } from "@better-update/type-guards";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../../application/app-store-connect";
import { uploadScreenshots } from "../../../application/app-store-media";
import { resolveScreenshotDisplayType } from "../../../lib/asc-display-types";
import { printHuman, printHumanTable } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const screenshotsUploadCommand = Command.make(
  "upload",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    locale: Flag.String("locale").pipe(Flag.withDescription("Locale, e.g. en-US")),
    device: Flag.String("device").pipe(
      Flag.withDescription("Device class, e.g. APP_IPHONE_67 or iphone-67"),
    ),
    dir: Flag.String("dir").pipe(
      Flag.withDescription("A directory of images, uploaded in sorted name order"),
      optionalFlag,
    ),
    file: Flag.String("file").pipe(
      Flag.withDescription("A single image to upload (use instead of/with --dir)"),
      optionalFlag,
    ),
    replace: Flag.Boolean("replace").pipe(
      Flag.withDescription("Delete the set's existing screenshots before uploading"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn(
    function* (args) {
      const locale = args.locale.trim();
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Upload screenshots to a locale + device set on the editable version"),
);
