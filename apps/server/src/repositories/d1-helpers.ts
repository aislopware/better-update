import { Data, Effect } from "effect";

import { Conflict } from "../errors";

export class D1StatementError extends Data.TaggedError("D1StatementError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const isUniqueConstraintError = (error: D1StatementError) =>
  String(error.cause).includes("UNIQUE constraint failed");

export const d1WithUniqueCheck = <T>(
  run: () => Promise<T>,
  conflictMessage: string,
): Effect.Effect<T, Conflict> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new D1StatementError({
        message: "D1 statement execution failed",
        cause,
      }),
  }).pipe(
    Effect.catchAll((error) =>
      isUniqueConstraintError(error)
        ? Effect.fail(new Conflict({ message: conflictMessage }))
        : Effect.die(error),
    ),
  );

export const d1RunWithUniqueCheck = (
  run: () => Promise<unknown>,
  conflictMessage: string,
): Effect.Effect<void, Conflict> => Effect.asVoid(d1WithUniqueCheck(run, conflictMessage));
