import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
} from "../../application/app-store-connect";
import { threadRejections } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHumanList } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const appReviewRejectionsCommand = Command.make(
  "rejections",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    thread: Flag.String("thread").pipe(
      Flag.withDescription("Resolution Center thread id (from `app-review list`)"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      const threadId = args.thread?.trim();
      if (threadId === undefined || threadId.length === 0) {
        return yield* new InvalidArgumentError({
          message: "--thread is required (a thread id from `app-review list`).",
        });
      }
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openCookieAppSession(args);
      const rejections = yield* threadRejections(session.ctx, session.appId, platform, threadId);
      yield* printHumanList(
        ["Section", "Code", "Guideline"],
        rejections.map((rejection) => [rejection.section, rejection.code, rejection.description]),
        "No guideline rejection reasons on this thread.",
      );
      return { items: rejections };
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Show the guideline rejection reasons attached to an App Review thread"),
);
