import { Conflict } from "@better-update/api";
import { Effect } from "effect";

export const d1RunWithUniqueCheck = (
  run: () => Promise<unknown>,
  conflictMessage: string,
): Effect.Effect<void, Conflict> =>
  Effect.tryPromise({
    try: run,
    catch: (error) => error,
  }).pipe(
    // eslint-disable-next-line promise/prefer-await-to-callbacks -- Effect.catchAll is functional composition
    Effect.catchAll((error) =>
      String(error).includes("UNIQUE constraint failed")
        ? Effect.fail(new Conflict({ message: conflictMessage }))
        : Effect.die(error),
    ),
    Effect.asVoid,
  );
