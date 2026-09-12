import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { setAgeRating } from "../../../application/app-store-age-rating";
import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { asJsonObject, readJsonInput } from "../../../lib/json-input";
import { printHuman } from "../../../lib/output";
import { optionalFlag } from "../../../lib/params";
import { runCommand } from "../../../lib/run-command";

export const ageRatingSetCommand = Command.make(
  "set",
  {
    ...ASC_COMMON_ARGS,
    from: Flag.String("from").pipe(
      Flag.withDescription(
        'JSON file path or inline JSON of declaration fields, e.g. { "violenceCartoonOrFantasy": "INFREQUENT_OR_MILD" } (required)',
      ),
      optionalFlag,
    ),
  },
  Effect.fn(
    function* (args) {
      if (args.from === undefined || args.from.trim().length === 0) {
        return yield* new InvalidArgumentError({ message: "--from is required." });
      }
      const document = yield* asJsonObject(yield* readJsonInput(args.from), "--from age rating");
      const session = yield* openAscSession(args);
      const result = yield* setAgeRating(session.ctx, session.appId, document);
      yield* printHuman(
        result.ignored.length === 0
          ? `Set age-rating fields: ${result.applied.join(", ")}.`
          : `Set age-rating fields: ${result.applied.join(", ")}. Ignored unknown: ${result.ignored.join(", ")}.`,
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Set the age-rating declaration from a JSON document (--from file or inline JSON)",
  ),
);
