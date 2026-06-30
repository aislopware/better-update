import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
} from "../../application/app-store-connect";
import { replyToThread } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface AppReviewReplyArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly thread?: string | undefined;
  readonly body?: string | undefined;
  readonly "text-file"?: string | undefined;
}

export const appReviewReplyCommand = defineCommand({
  meta: {
    name: "reply",
    description: "Reply to App Review on a thread (text only; writes to your live submission)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    thread: { type: "string", description: "Resolution Center thread id (from `app-review list`)" },
    body: { type: "string", description: "The reply text" },
    "text-file": { type: "string", description: "Read the reply from a file instead of --body" },
  },
  run: async ({ args }: { readonly args: AppReviewReplyArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
