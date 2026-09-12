import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_COMMON_ARGS, openAscSession } from "../../application/app-store-connect";
import { listReviews } from "../../application/customer-reviews";
import { parseStarRating } from "../../lib/asc-arg-parsers";
import { printHumanList } from "../../lib/output";
import { optionalFlag, positiveIntFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const reviewsListCommand = Command.make(
  "list",
  {
    ...ASC_COMMON_ARGS,
    rating: Flag.String("rating").pipe(
      Flag.withDescription("Filter by star rating (1–5)"),
      optionalFlag,
    ),
    territory: Flag.String("territory").pipe(
      Flag.withDescription("Filter by territory code (e.g. USA)"),
      optionalFlag,
    ),
    limit: positiveIntFlag("limit", { description: "Max reviews to return", defaultValue: 50 }),
  },
  Effect.fn(
    function* (args) {
      const rating = yield* parseStarRating(args.rating);
      const { limit } = args;
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("List the app's customer reviews, newest first (CI-safe)"));
