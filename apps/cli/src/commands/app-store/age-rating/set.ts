import { defineCommand } from "citty";
import { Effect } from "effect";

import { setAgeRating } from "../../../application/app-store-age-rating";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { InvalidArgumentError } from "../../../lib/exit-codes";
import { asJsonObject, readJsonInput } from "../../../lib/json-input";
import { printHuman } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

interface AgeRatingSetArgs extends AscCommonArgs {
  readonly from?: string | undefined;
}

export const ageRatingSetCommand = defineCommand({
  meta: {
    name: "set",
    description: "Set the age-rating declaration from a JSON document (--from file or inline JSON)",
  },
  args: {
    ...ASC_COMMON_ARGS,
    from: {
      type: "string",
      description:
        'JSON file path or inline JSON of declaration fields, e.g. { "violenceCartoonOrFantasy": "INFREQUENT_OR_MILD" } (required)',
    },
  },
  run: async ({ args }: { readonly args: AgeRatingSetArgs }) =>
    runEffect(
      Effect.gen(function* () {
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
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
