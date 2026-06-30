import { defineCommand } from "citty";
import { Effect } from "effect";

import { getAgeRating } from "../../../application/app-store-age-rating";
import {
  APP_STORE_EXIT_EXTRAS,
  ASC_COMMON_ARGS,
  openAscSession,
} from "../../../application/app-store-connect";
import { runEffect } from "../../../lib/citty-effect";
import { printHumanKeyValue } from "../../../lib/output";

import type { AscCommonArgs } from "../../../application/app-store-connect";

export const ageRatingGetCommand = defineCommand({
  meta: {
    name: "get",
    description: "Show the app's age-rating content declaration",
  },
  args: { ...ASC_COMMON_ARGS },
  run: async ({ args }: { readonly args: AscCommonArgs }) =>
    runEffect(
      Effect.gen(function* () {
        const session = yield* openAscSession(args);
        const result = yield* getAgeRating(session.ctx, session.appId);
        yield* printHumanKeyValue(
          Object.entries(result.declaration).map(([key, value]) => [key, String(value)]),
        );
        return result;
      }),
      { exits: APP_STORE_EXIT_EXTRAS, json: "value" },
    ),
});
