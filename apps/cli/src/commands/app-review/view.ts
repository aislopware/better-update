import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
} from "../../application/app-store-connect";
import { viewThread } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const appReviewViewCommand = Command.make(
  "view",
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
      const result = yield* viewThread(session.ctx, session.appId, platform, threadId);
      yield* printHuman(
        `Thread ${result.thread.id} (${result.thread.threadType}, ${result.thread.state})`,
      );
      for (const message of result.messages) {
        yield* printHuman(`\n— ${message.createdDate} —\n${message.text}`);
      }
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Show an App Review thread's full transcript (messages rendered as plain text)",
  ),
);
