import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { InvalidArgumentError } from "./exit-codes";

/**
 * Read a `--from` JSON argument that is either inline JSON (a value starting with
 * `{` or `[`) or a path to a JSON file. Returns the parsed value as `unknown` —
 * the caller validates its shape. Used by the metadata commands authored from a
 * JSON document (`age-rating set`, `privacy set`) rather than a flag matrix.
 */
export const readJsonInput = (
  raw: string,
): Effect.Effect<unknown, InvalidArgumentError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const trimmed = raw.trim();
    const isInline = trimmed.startsWith("{") || trimmed.startsWith("[");
    const text = isInline
      ? trimmed
      : yield* (yield* FileSystem.FileSystem).readFileString(raw).pipe(
          Effect.mapError(
            (cause) =>
              new InvalidArgumentError({
                message: `Could not read --from file "${raw}": ${String(cause)}`,
              }),
          ),
        );
    return yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: (cause) =>
        new InvalidArgumentError({
          message: `Invalid JSON in --from ${isInline ? "argument" : `file "${raw}"`}: ${String(cause)}`,
        }),
    });
  });

/** Narrow a parsed JSON value to a plain object, failing when it is an array/primitive. */
export const asJsonObject = (
  value: unknown,
  label: string,
): Effect.Effect<Record<string, unknown>, InvalidArgumentError> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Effect.fail(new InvalidArgumentError({ message: `${label} must be a JSON object.` }));
  }
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- guarded above: value is a non-null, non-array object
  return Effect.succeed(value as Record<string, unknown>);
};

/** Narrow a parsed JSON value to an array, failing otherwise. */
export const asJsonArray = (
  value: unknown,
  label: string,
): Effect.Effect<readonly unknown[], InvalidArgumentError> => {
  if (!Array.isArray(value)) {
    return Effect.fail(new InvalidArgumentError({ message: `${label} must be a JSON array.` }));
  }
  return Effect.succeed(value);
};
