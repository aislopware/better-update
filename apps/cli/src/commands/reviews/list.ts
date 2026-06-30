import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../application/app-store-connect";
import { listReviews } from "../../application/customer-reviews";
import { parseStarRating } from "../../lib/asc-arg-parsers";
import { runEffect } from "../../lib/citty-effect";
import { printHumanList } from "../../lib/output";

import type { AscCommonArgs } from "../../application/app-store-connect";

interface ReviewsListArgs extends AscCommonArgs {
  readonly rating?: string | undefined;
  readonly territory?: string | undefined;
  readonly limit?: string | undefined;
}

export const reviewsListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the app's customer reviews, newest first (CI-safe)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    rating: { type: "string", description: "Filter by star rating (1–5)" },
    territory: { type: "string", description: "Filter by territory code (e.g. USA)" },
    limit: { type: "string", default: "50", description: "Max reviews to return (default: 50)" },
  },
  run: async ({ args }: { readonly args: ReviewsListArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const rating = yield* parseStarRating(args.rating);
        const limit = Number.parseInt(args.limit ?? "50", 10) || 50;
        const session = yield* openAscSession(args);
        const reviews = yield* listReviews(session.ctx, session.appId, {
          rating,
          territory: args.territory,
          limit,
        });
        yield* printHumanList(
          ["Rating", "Title", "Reviewer", "Territory", "Created", "Replied", "ID"],
          reviews.map((review) => [
            "★".repeat(review.rating),
            review.title ?? "—",
            review.reviewerNickname,
            review.territory,
            review.createdDate,
            review.responseState ?? "—",
            review.id,
          ]),
          "No customer reviews found.",
        );
        return { items: reviews };
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
