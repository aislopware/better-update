import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  normalizePlatform,
  openAscSession,
  resolveReviewDetailInput,
  REVIEW_DETAIL_ARGS,
} from "../../../application/app-store-connect";
import { setReviewDetail } from "../../../application/app-store-review";
import { runEffect } from "../../../lib/citty-effect";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs, ReviewDetailArgs } from "../../../application/app-store-connect";

interface ReviewDetailSetArgs extends AscCommonArgs, ReviewDetailArgs {
  readonly platform?: string | undefined;
}

export const reviewDetailSetCommand = defineCommand({
  meta: {
    name: "set",
    description: "Set the App Review contact + demo account on the editable version",
  },
  args: {
    ...ASC_COMMON_ARGS,
    ...REVIEW_DETAIL_ARGS,
    platform: {
      type: "string",
      default: "ios",
      description: "Platform: ios (default), mac, tv, vision",
    },
  },
  run: async ({ args }: { readonly args: ReviewDetailSetArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const input = yield* resolveReviewDetailInput(args);
        const platform = yield* normalizePlatform(args.platform);
        const session = yield* openAscSession(args);
        const result = yield* setReviewDetail(session.ctx, session.appId, platform, input);
        yield* printHuman(`Updated App Review detail (${result.fields.join(", ")}).`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
