import { FileSystem, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { ASC_AUTH_ARGS, openAscContext } from "../../application/app-store-connect";
import { replyToReview } from "../../application/customer-reviews";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { optionalFlag } from "../../lib/params";
import { runCommand } from "../../lib/run-command";

export const reviewsReplyCommand = Command.make(
  "reply",
  {
    ...ASC_AUTH_ARGS,
    review: Flag.String("review").pipe(Flag.withDescription("Customer review id to respond to")),
    body: Flag.String("body").pipe(Flag.withDescription("The response text"), optionalFlag),
    "text-file": Flag.String("text-file").pipe(
      Flag.withDescription("Read the response from a file instead of --body"),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Post a public developer response to a customer review (CI-safe)"));
