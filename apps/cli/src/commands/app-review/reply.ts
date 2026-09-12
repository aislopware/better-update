import { FileSystem, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
} from "../../application/app-store-connect";
import { replyToThread } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const appReviewReplyCommand = Command.make(
  "reply",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
    thread: Flag.String("thread").pipe(
      Flag.withDescription("Resolution Center thread id (from `app-review list`)"),
      optionalFlag,
    ),
    body: Flag.String("body").pipe(Flag.withDescription("The reply text"), optionalFlag),
    "text-file": Flag.String("text-file").pipe(
      Flag.withDescription("Read the reply from a file instead of --body"),
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
      const fromFile = args["text-file"];
      const inline = args.body;
      const body = yield* Effect.gen(function* () {
        if (fromFile !== undefined) {
          return yield* (yield* FileSystem.FileSystem).readFileString(fromFile).pipe(
            Effect.mapError(
              (cause) =>
                new InvalidArgumentError({
                  message: `Could not read --text-file "${fromFile}": ${String(cause)}`,
                }),
            ),
          );
        }
        if (inline !== undefined) {
          return inline;
        }
        return yield* new InvalidArgumentError({ message: "Pass --body or --text-file." });
      });
      // Guard against posting a blank reply to the live submission (an empty
      // --body / --text-file is irreversible once sent to Apple's reviewers).
      if (body.trim().length === 0) {
        return yield* new InvalidArgumentError({
          message: "The reply body is empty. Pass a non-empty --body or --text-file.",
        });
      }
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openCookieAppSession(args);
      const result = yield* replyToThread(session.ctx, session.appId, platform, threadId, body);
      yield* printHuman(`Sent reply to App Review thread ${result.threadId}.`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Reply to App Review on a thread (text only; writes to your live submission)",
  ),
);
