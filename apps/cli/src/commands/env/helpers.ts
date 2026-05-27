import { Data, Effect } from "effect";

import { InvalidArgumentError } from "../../lib/exit-codes";

import type { ApiClient } from "../../services/api-client";

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

const DOTENV_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u;

const stripQuotes = (raw: string): string => {
  if (raw.length < 2) {
    return raw;
  }
  const [first] = raw;
  const last = raw.at(-1);
  const quoted = (first === '"' && last === '"') || (first === "'" && last === "'");
  return quoted ? raw.slice(1, -1) : raw;
};

export interface DotenvEntry {
  readonly key: string;
  readonly value: string;
}

const parseDotenvLine = (rawLine: string): DotenvEntry | undefined => {
  const line = rawLine.trim();
  if (line === "" || line.startsWith("#")) {
    return undefined;
  }
  const match = DOTENV_LINE.exec(line);
  if (!match) {
    return undefined;
  }
  const [, key, rawValue] = match;
  if (key === undefined || rawValue === undefined) {
    return undefined;
  }
  return { key, value: stripQuotes(rawValue) };
};

/** Parse a dotenv file's `KEY=VALUE` lines (comments + blanks skipped, quotes stripped). */
export const parseDotenv = (content: string): readonly DotenvEntry[] =>
  content
    .split(/\r?\n/u)
    .map(parseDotenvLine)
    .filter((entry): entry is DotenvEntry => entry !== undefined);

/** Resolve a single project env var by (key, environment), or fail NotFound. */
export const findProjectEnvVar = (
  api: ApiClient,
  projectId: string,
  key: string,
  environment: EnvironmentName,
) =>
  Effect.gen(function* () {
    const { items } = yield* api["env-vars"].list({
      urlParams: { projectId, scope: "project", environments: environment },
    });
    const match = items.find((item) => item.key === key && item.environment === environment);
    if (!match) {
      return yield* new EnvResourceNotFoundError({
        message: `Env var "${key}" not found for environment "${environment}".`,
      });
    }
    return match;
  });
