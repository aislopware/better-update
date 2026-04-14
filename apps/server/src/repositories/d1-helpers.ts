import { Either, Effect } from "effect";

import { Conflict } from "../errors";

export const d1RunWithUniqueCheck = (
  run: () => Promise<unknown>,
  conflictMessage: string,
): Effect.Effect<void, Conflict> =>
  Effect.tryPromise({
    try: run,
    catch: (error) => error,
  }).pipe(
    Effect.either,
    Effect.flatMap((result) => {
      if (Either.isRight(result)) {
        return Effect.void;
      }
      if (String(result.left).includes("UNIQUE constraint failed")) {
        return Effect.fail(new Conflict({ message: conflictMessage }));
      }
      return Effect.die(result.left);
    }),
  );
