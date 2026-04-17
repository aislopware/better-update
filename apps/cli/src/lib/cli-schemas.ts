import { Args, Options } from "@effect/cli";
import { ParseResult, Schema } from "effect";

export const RolloutPercentage = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, 100),
).annotations({
  message: () => "Rollout percentage must be between 1 and 100.",
  identifier: "RolloutPercentage",
});

export const rolloutPercentageOption = (name: string): Options.Options<number> =>
  Options.integer(name).pipe(Options.withSchema(RolloutPercentage));

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

export const keyValueArg = (name: string): Args.Args<KeyValuePair> =>
  Args.text({ name }).pipe(Args.withSchema(KeyValueFromString));
