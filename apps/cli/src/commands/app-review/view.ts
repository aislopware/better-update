import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
} from "../../application/app-store-connect";
import { viewThread } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface AppReviewViewArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly thread?: string | undefined;
}

export const appReviewViewCommand = defineCommand({
  meta: {
    name: "view",
    description: "Show an App Review thread's full transcript (messages rendered as plain text)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
    thread: { type: "string", description: "Resolution Center thread id (from `app-review list`)" },
  },
  run: async ({ args }: { readonly args: AppReviewViewArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
