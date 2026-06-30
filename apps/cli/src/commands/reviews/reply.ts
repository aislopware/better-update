import { FileSystem } from "@effect/platform";
import { defineCommand } from "citty";
import { Effect } from "effect";

import {
  APP_STORE_EXIT_EXTRAS,
  ASC_AUTH_ARGS,
  openAscContext,
} from "../../application/app-store-connect";
import { replyToReview } from "../../application/customer-reviews";
import { runEffect } from "../../lib/citty-effect";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";

import type { AscAuthArgs } from "../../application/app-store-connect";

interface ReviewsReplyArgs extends AscAuthArgs {
  readonly review: string;
  readonly body?: string | undefined;
  readonly "text-file"?: string | undefined;
}

export const reviewsReplyCommand = defineCommand({
  meta: {
    name: "reply",
    description: "Post a public developer response to a customer review (CI-safe)",
  },
  args: {
    ...ASC_AUTH_ARGS,
    review: { type: "string", required: true, description: "Customer review id to respond to" },
    body: { type: "string", description: "The response text" },
    "text-file": { type: "string", description: "Read the response from a file instead of --body" },
  },
  run: async ({ args }: { readonly args: ReviewsReplyArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const fromFile = args["text-file"];
        const inline = args.body;
        const body = yield* Effect.gen(function* () {
          if (fromFile !== undefined) {
            return yield* (yield* FileSystem.FileSystem).readFileString(fromFile).pipe(
              Effect.mapError(
                (cause) =>
                  new InvalidArgumentError({
                    message: `Could not read --text-file "${fromFile}": ${String(cause)}`,
                  }),
              ),
            );
          }
          if (inline !== undefined) {
            return inline;
          }
          return yield* new InvalidArgumentError({ message: "Pass --body or --text-file." });
        });
        if (body.trim().length === 0) {
          return yield* new InvalidArgumentError({
            message: "The response body is empty. Pass a non-empty --body or --text-file.",
          });
        }
        const session = yield* openAscContext(args);
        const result = yield* replyToReview(session.ctx, args.review, body);
        yield* printHuman(`Posted response to review ${result.reviewId} (state: ${result.state}).`);
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
