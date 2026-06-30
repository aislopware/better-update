import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
} from "../../application/app-store-connect";
import { threadRejections } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHumanList } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface AppReviewRejectionsArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
  readonly thread?: string | undefined;
}

export const appReviewRejectionsCommand = defineCommand({
  meta: {
    name: "rejections",
    description: "Show the guideline rejection reasons attached to an App Review thread",
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
  run: async ({ args }: { readonly args: AppReviewRejectionsArgs }) =>
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
        const rejections = yield* threadRejections(session.ctx, session.appId, platform, threadId);
        yield* printHumanList(
          ["Section", "Code", "Guideline"],
          rejections.map((rejection) => [rejection.section, rejection.code, rejection.description]),
          "No guideline rejection reasons on this thread.",
        );
        return { items: rejections };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
