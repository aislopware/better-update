import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
  resolveReviewDetailInput,
  REVIEW_DETAIL_ARGS,
} from "../../../application/app-store-connect";
import { setBetaReviewDetail } from "../../../application/testflight-review";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs, ReviewDetailArgs } from "../../../application/app-store-connect";

interface ReviewSetDetailArgs extends AscCommonArgs, ReviewDetailArgs {}

export const reviewSetDetailCommand = defineCommand({
  meta: {
    name: "set-detail",
    description:
      "Set the app's beta review detail (contact + demo account) — external-review prereq",
  },
  args: { ...ASC_COMMON_ARGS, ...REVIEW_DETAIL_ARGS },
  run: async ({ args }: { readonly args: ReviewSetDetailArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const input = yield* resolveReviewDetailInput(args);
        const session = yield* openAscSession(args);
        const result = yield* setBetaReviewDetail(session.ctx, session.appId, input);
        yield* printHuman(`Updated beta review detail (${result.fields.join(", ")}).`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
