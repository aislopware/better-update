import { Data, Effect } from "effect";

import { InvalidArgumentError } from "../../lib/exit-codes";

export class EnvResourceNotFoundError extends Data.TaggedError("EnvResourceNotFoundError")<{
  readonly message: string;
}> {}

export const envErrorExtras = {
  EnvResourceNotFoundError: 1,
  SystemError: 6,
  BadArgument: 6,
} as const;

export type EnvironmentName = "development" | "preview" | "production";

const isEnvironmentName = (value: string): value is EnvironmentName =>
  value === "development" || value === "preview" || value === "production";

export const parseEnvironmentsArg = (
  raw: string,
): Effect.Effect<readonly EnvironmentName[], InvalidArgumentError> =>
  Effect.gen(function* () {
    const tokens = raw
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return yield* new InvalidArgumentError({
        message: "Provide at least one environment (development, preview, production).",
      });
    }
    const seen = new Set<EnvironmentName>();
    yield* Effect.forEach(
      tokens,
      (token) =>
        Effect.gen(function* () {
          if (!isEnvironmentName(token)) {
            return yield* new InvalidArgumentError({
              message: `Invalid environment "${token}". Must be one of: development, preview, production.`,
            });
          }
          seen.add(token);
          return undefined;
        }),
      { discard: true },
    );
    return [...seen];
  });

export const parseSingleEnvironmentArg = (
  raw: string,
): Effect.Effect<EnvironmentName, InvalidArgumentError> =>
  Effect.gen(function* () {
    if (!isEnvironmentName(raw)) {
      return yield* new InvalidArgumentError({
        message: `Invalid environment "${raw}". Must be one of: development, preview, production.`,
      });
    }
    return raw;
  });

export const formatEnvironments = (environments: readonly EnvironmentName[]): string =>
  [...environments].toSorted((left, right) => left.localeCompare(right)).join(",");
