import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  ASC_PLATFORM_FLAG,
  normalizePlatform,
  openAscSession,
  resolveReviewDetailInput,
  REVIEW_DETAIL_ARGS,
} from "../../../application/app-store-connect";
import { setReviewDetail } from "../../../application/app-store-review";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const reviewDetailSetCommand = Command.make(
  "set",
  {
    ...ASC_COMMON_ARGS,
    ...REVIEW_DETAIL_ARGS,
    platform: ASC_PLATFORM_FLAG,
  },
  Effect.fn(
    function* (args) {
      const input = yield* resolveReviewDetailInput(args);
      const platform = yield* normalizePlatform(args.platform);
      const session = yield* openAscSession(args);
      const result = yield* setReviewDetail(session.ctx, session.appId, platform, input);
      yield* printHuman(`Updated App Review detail (${result.fields.join(", ")}).`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription("Set the App Review contact + demo account on the editable version"),
);
