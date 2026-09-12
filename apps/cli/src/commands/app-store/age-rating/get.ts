import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { getAgeRating } from "../../../application/app-store-age-rating";
import { ASC_COMMON_ARGS, openAscSession } from "../../../application/app-store-connect";
import { printHumanKeyValue } from "../../../lib/output";
import { runCommand } from "../../../lib/run-command";

export const ageRatingGetCommand = Command.make(
  "get",
  {
    ...ASC_COMMON_ARGS,
  },
  Effect.fn(
    function* (args) {
      const session = yield* openAscSession(args);
      const result = yield* getAgeRating(session.ctx, session.appId);
      yield* printHumanKeyValue(
        Object.entries(result.declaration).map(([key, value]) => [key, String(value)]),
      );
      return result;
    },
    runCommand({ json: "value" }),
  ),
).pipe(Command.withDescription("Show the app's age-rating content declaration"));
