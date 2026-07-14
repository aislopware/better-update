import { it } from "@effect/vitest";
import { Effect } from "effect";

import {
  currentLogPrefix,
  finalCarriageSegment,
  platformLogPrefix,
  withLogPrefix,
} from "./log-prefix";

describe(finalCarriageSegment, () => {
  it("returns a plain line unchanged", () => {
    expect(finalCarriageSegment("BUILD SUCCESSFUL in 2m")).toBe("BUILD SUCCESSFUL in 2m");
  });

  it("keeps only the final carriage-return segment", () => {
    expect(finalCarriageSegment("frame1\rframe2\rdone")).toBe("done");
  });

  it("ignores trailing carriage returns", () => {
    expect(finalCarriageSegment("frame1\rframe2\r")).toBe("frame2");
  });

  it("returns an empty line as-is", () => {
    expect(finalCarriageSegment("")).toBe("");
  });
});

describe(platformLogPrefix, () => {
  it("tags each platform and aligns widths", () => {
    const ios = platformLogPrefix("ios");
    const android = platformLogPrefix("android");
    expect(ios).toContain("[ios]");
    expect(android).toContain("[android]");
  });
});

describe(withLogPrefix, () => {
  it.effect("scopes the prefix to the wrapped effect", () =>
    Effect.gen(function* () {
      expect(yield* currentLogPrefix).toBeUndefined();
      const inside = yield* currentLogPrefix.pipe(withLogPrefix("[ios] "));
      expect(inside).toBe("[ios] ");
      expect(yield* currentLogPrefix).toBeUndefined();
    }),
  );

  it.effect("keeps concurrent fibers on their own prefixes", () =>
    Effect.gen(function* () {
      const [left, right] = yield* Effect.all(
        [
          currentLogPrefix.pipe(withLogPrefix("[ios] ")),
          currentLogPrefix.pipe(withLogPrefix("[android] ")),
        ],
        { concurrency: 2 },
      );
      expect(left).toBe("[ios] ");
      expect(right).toBe("[android] ");
    }),
  );
});
