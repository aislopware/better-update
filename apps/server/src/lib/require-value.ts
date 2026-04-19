import { Effect, Schema } from "effect";

export class MissingValueError extends Schema.TaggedError<MissingValueError>()(
  "MissingValueError",
  {
    field: Schema.String,
  },
) {}

export class DataIntegrityError extends Schema.TaggedError<DataIntegrityError>()(
  "DataIntegrityError",
  {
    source: Schema.String,
    field: Schema.String,
  },
) {}

export const requireValue = <T>(
  value: T | null | undefined,
  field: string,
): Effect.Effect<NonNullable<T>, MissingValueError> =>
  value === null || value === undefined || (value as unknown) === ""
    ? Effect.fail(new MissingValueError({ field }))
    : Effect.succeed(value as NonNullable<T>);
