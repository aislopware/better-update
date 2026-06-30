import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
} from "../../application/app-store-connect";
import { listThreads } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { runEffect } from "../../lib/citty-effect";
import { printHumanList } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface AppReviewListArgs extends AscCommonArgs {
  readonly platform?: string | undefined;
}

export const appReviewListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the App Review (Resolution Center) threads on the app's open submission",
  },
  args: {
    ...ASC_COMMON_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: AppReviewListArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openCookieAppSession(args);
        const threads = yield* listThreads(session.ctx, session.appId, platform);
        yield* printHumanList(
          ["Thread id", "Type", "State", "Last message"],
          threads.map((thread) => [
            thread.id,
            thread.threadType,
            thread.state,
            thread.lastMessageResponseDate,
          ]),
          "No App Review threads (no in-progress review submission).",
        );
        return { items: threads };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
