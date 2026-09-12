import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import {
  ASC_COMMON_ARGS,
  openAscSession,
  resolveReviewDetailInput,
  REVIEW_DETAIL_ARGS,
} from "../../../application/app-store-connect";
import { setBetaReviewDetail } from "../../../application/testflight-review";
import { printHuman } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const reviewSetDetailCommand = Command.make(
  "set-detail",
  {
    ...ASC_COMMON_ARGS,
    ...REVIEW_DETAIL_ARGS,
  },
  Effect.fn(
    function* (args) {
      const input = yield* resolveReviewDetailInput(args);
      const session = yield* openAscSession(args);
      const result = yield* setBetaReviewDetail(session.ctx, session.appId, input);
      yield* printHuman(`Updated beta review detail (${result.fields.join(", ")}).`);
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Set the app's beta review detail (contact + demo account) — external-review prereq",
  ),
);
