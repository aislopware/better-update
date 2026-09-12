import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
} from "../../application/app-store-connect";
import { cancelReview } from "../../application/app-store-review";
import { printHuman } from "../../lib/output";
import { runCommand } from "../../lib/run-command";

export const appStoreCancelCommand = Command.make(
  "cancel",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const result = yield* cancelReview(session.ctx, session.appId, platform);
      yield* printHuman(`Cancelled review submission ${result.submissionId}.`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Cancel the app's in-progress App Review submission"));
