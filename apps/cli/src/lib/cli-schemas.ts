import { Effect, ParseResult, Schema } from "effect";

import { InvalidArgumentError } from "./exit-codes";

export const RolloutPercentage = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, 100),
).annotations({
  message: () => "Rollout percentage must be between 1 and 100.",
  identifier: "RolloutPercentage",
});

export const KeyValuePair = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
});
export type KeyValuePair = Schema.Schema.Type<typeof KeyValuePair>;

export const KeyValueFromString = Schema.transformOrFail(Schema.String, KeyValuePair, {
  strict: true,
  decode: (input, _options, ast) => {
    const eqIndex = input.indexOf("=");
    if (eqIndex <= 0) {
      return ParseResult.fail(
        new ParseResult.Type(ast, input, "Invalid format. Use KEY=VALUE (e.g. API_KEY=abc123)"),
      );
    }
    return ParseResult.succeed({
      key: input.slice(0, eqIndex),
      value: input.slice(eqIndex + 1),
    });
  },
  encode: ({ key, value }) => ParseResult.succeed(`${key}=${value}`),
});

export const parseRolloutPercentage = (
  raw: string,
  flag: string,
): Effect.Effect<number, InvalidArgumentError> =>
  Schema.decodeUnknown(RolloutPercentage)(Number(raw)).pipe(
    Effect.mapError(
      () =>
        new InvalidArgumentError({
          message: `--${flag} must be an integer between 1 and 100, got "${raw}".`,
        }),
    ),
  );

export const parseKeyValue = (raw: string): Effect.Effect<KeyValuePair, InvalidArgumentError> =>
  Schema.decodeUnknown(KeyValueFromString)(raw).pipe(
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
