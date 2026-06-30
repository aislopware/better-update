import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { parseStarRating, splitCommaList } from "./asc-arg-parsers";
import { failureError } from "./test-utils";

describe(splitCommaList, () => {
  it("splits, trims, and drops empty parts", () => {
    expect(splitCommaList("DEVELOPER, APP_MANAGER ,, ADMIN")).toStrictEqual([
      "DEVELOPER",
      "APP_MANAGER",
      "ADMIN",
    ]);
  });

  it("returns an empty list for a blank string", () => {
    expect(splitCommaList("  ,  ")).toStrictEqual([]);
  });
});

describe(parseStarRating, () => {
  it.effect("passes undefined through (no filter)", () =>
    Effect.gen(function* () {
      expect(yield* parseStarRating(undefined)).toBeUndefined();
    }),
  );

  it.effect("parses a valid 1–5 rating", () =>
    Effect.gen(function* () {
      expect(yield* parseStarRating("4")).toBe(4);
      expect(yield* parseStarRating(" 1 ")).toBe(1);
    }),
  );

  it.effect("rejects out-of-range, fractional, and non-numeric values", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseStarRating("6"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain("--rating must be an integer 1–5");
      expect(Exit.isFailure(yield* Effect.exit(parseStarRating("0")))).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(parseStarRating("3.5")))).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(parseStarRating("3abc")))).toBe(true);
    }),
  );
});
