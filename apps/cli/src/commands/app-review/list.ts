import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
} from "../../application/app-store-connect";
import { listThreads } from "../../application/apple-app-review";
import { openCookieAppSession } from "../../application/asc-cookie-session";
import { printHumanList } from "../../lib/output";
import { runCommand } from "../../lib/run-command";

export const appReviewListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "List the App Review (Resolution Center) threads on the app's open submission",
  ),
);
