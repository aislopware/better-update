/**
 * App Store Connect **customer reviews** on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs the `reviews` command group: list
 * public reviews and post a developer response. Token/CI-safe.
 *
 * A reply publishes publicly and is moderated by Apple (`PENDING_PUBLISH` →
 * `PUBLISHED`); there is no update API, so editing a reply means delete + recreate.
 */
import { compact, toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { getApp } from "./app-store-versions";

/** A customer review projected to the fields the CLI surfaces. */
export interface ReviewView {
  readonly id: string;
  readonly rating: number;
  readonly title: string | null;
  readonly reviewerNickname: string;
  readonly territory: string;
  readonly createdDate: string;
  readonly responseState: string | null;
}

const toView = (review: AppleUtils.CustomerReview): ReviewView => ({
  id: review.id,
  rating: review.attributes.rating,
  title: toDbNull(review.attributes.title),
  reviewerNickname: review.attributes.reviewerNickname,
  territory: review.attributes.territory,
  createdDate: review.attributes.createdDate,
  responseState: toDbNull(review.attributes.response?.attributes.state),
});

export interface ListReviewsInput {
  readonly rating: number | undefined;
  readonly territory: string | undefined;
  readonly limit: number;
}

/** List the app's customer reviews, newest first, optionally filtered by rating/territory. */
export const listReviews = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  input: ListReviewsInput,
) =>
  Effect.gen(function* () {
    const app = yield* getApp(ctx, appId);
    const reviews = yield* wrapConnect("apple-list-reviews", async () =>
      app.getCustomerReviewsAsync({
        query: {
          filter: compact({ rating: input.rating, territory: input.territory }),
          sort: "-createdDate",
          limit: input.limit,
        },
      }),
    );
    return reviews.map(toView);
  });

/**
 * Post (or replace) the developer response to a review. The response starts in
 * `PENDING_PUBLISH` and becomes `PUBLISHED` after Apple moderation.
 */
export const replyToReview = (
  ctx: AppleUtils.RequestContext,
  reviewId: string,
  responseBody: string,
) =>
  wrapConnect("apple-reply-review", async () =>
    AppleUtils.CustomerReviewResponse.createAsync(ctx, { responseBody, reviewId }),
  ).pipe(
    Effect.map((response) => ({
      id: response.id,
      reviewId,
      state: response.attributes.state,
    })),
  );
