/**
 * Small pure parsers for App Store Connect command flags shared across the
 * `apple` / `app-store` / `reviews` leaves: comma-separated lists (roles, app
 * ids) and the `--rating` star filter. Kept here so they can be unit-tested
 * without booting a command.
 */
import { Effect } from "effect";

import { InvalidArgumentError } from "./exit-codes";

/** Split a comma-separated flag value into trimmed, non-empty parts. */
export const splitCommaList = (raw: string): readonly string[] =>
  raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * Parse an optional `--rating` flag into a 1–5 integer, or `undefined` when the
 * flag was omitted. Rejects non-integers and out-of-range values.
 */
export const parseStarRating = (
  raw: string | undefined,
): Effect.Effect<number | undefined, InvalidArgumentError> => {
  if (raw === undefined) {
    return Effect.succeed(undefined);
  }
  const rating = Number(raw.trim());
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Effect.fail(
      new InvalidArgumentError({ message: `--rating must be an integer 1–5, got "${raw}".` }),
    );
  }
  return Effect.succeed(rating);
};
