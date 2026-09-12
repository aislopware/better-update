import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { submitForReview } from "../../application/app-store-review";
import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";

export const appStoreSubmitCommand = Command.make(
  "submit",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const result = yield* submitForReview(session.ctx, session.appId, platform);
      yield* printHuman(
        result.alreadyInProgress
          ? `A review submission is already in progress for ${result.versionString} (${result.state}).`
          : `Submitted ${result.versionString} for App Review (${result.state}).`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Submit the editable App Store version for App Review (idempotent)"),
);
