import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";

import { InvalidArgumentError } from "./exit-codes";

export const RolloutPercentage = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 100 }),
).annotate({
  message: "Rollout percentage must be between 1 and 100.",
  identifier: "RolloutPercentage",
});

export const KeyValuePair = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
});
export type KeyValuePair = typeof KeyValuePair.Type;

// v4 replaced `Schema.transformOrFail` with `decodeTo` + a fallible
// `SchemaGetter`; the failure channel carries a `SchemaIssue` rather than a
// `ParseResult` error.
const INVALID_KEY_VALUE = "Invalid format. Use KEY=VALUE (e.g. API_KEY=abc123)";

export const KeyValueFromString = Schema.String.pipe(
  Schema.decodeTo(KeyValuePair, {
    decode: SchemaGetter.transformOrFail((input: string) => {
      const eqIndex = input.indexOf("=");
      return eqIndex <= 0
        ? Effect.fail(new SchemaIssue.InvalidValue({ message: INVALID_KEY_VALUE }, input))
        : Effect.succeed({
            key: input.slice(0, eqIndex),
            value: input.slice(eqIndex + 1),
          });
    }),
    encode: SchemaGetter.transform(({ key, value }: KeyValuePair) => `${key}=${value}`),
  }),
);

export const parseRolloutPercentage = (
  raw: string,
  flag: string,
): Effect.Effect<number, InvalidArgumentError> =>
  Schema.decodeUnknownEffect(RolloutPercentage)(Number(raw)).pipe(
    Effect.mapError(
      () =>
        new InvalidArgumentError({
          message: `--${flag} must be an integer between 1 and 100, got "${raw}".`,
        }),
    ),
  );

export const parseKeyValue = (raw: string): Effect.Effect<KeyValuePair, InvalidArgumentError> =>
  Schema.decodeUnknownEffect(KeyValueFromString)(raw).pipe(
    Effect.mapError(
      () =>
        new InvalidArgumentError({
          message: "Invalid format. Use KEY=VALUE (e.g. API_KEY=abc123)",
        }),
    ),
  );

export const parseLimit = (
  raw: string | undefined,
  defaultValue: number,
): Effect.Effect<number, InvalidArgumentError> => {
  if (raw === undefined) {
    return Effect.succeed(defaultValue);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return Effect.fail(
      new InvalidArgumentError({ message: `--limit must be a positive integer, got "${raw}".` }),
    );
  }
  return Effect.succeed(parsed);
};
