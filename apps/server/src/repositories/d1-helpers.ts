import { Data, Effect } from "effect";

import type { Compilable } from "kysely";

import { Conflict } from "../errors";

/** Compile Kysely queries into bound D1 statements for `session.batch`. */
export const bindForBatch = (
  session: D1DatabaseSession,
  queries: readonly Compilable[],
): D1PreparedStatement[] =>
  queries.map((query) => {
    const compiled = query.compile();
    return session.prepare(compiled.sql).bind(...compiled.parameters);
  });

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
