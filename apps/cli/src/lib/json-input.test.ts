import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { asJsonArray, asJsonObject } from "./json-input";
import { failureError } from "./test-utils";

describe(asJsonObject, () => {
  it.effect("passes a plain object through", () =>
    Effect.gen(function* () {
      expect(yield* asJsonObject({ key: 1 }, "doc")).toStrictEqual({ key: 1 });
    }),
  );

  it.effect("rejects an array", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(asJsonObject([1, 2], "doc"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain("doc must be a JSON object");
    }),
  );

  it.effect("rejects a primitive", () =>
    Effect.gen(function* () {
      expect(Exit.isFailure(yield* Effect.exit(asJsonObject("nope", "doc")))).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(asJsonObject(null, "doc")))).toBe(true);
    }),
  );
});

describe(asJsonArray, () => {
  it.effect("passes an array through", () =>
    Effect.gen(function* () {
      expect(yield* asJsonArray([1, 2], "list")).toStrictEqual([1, 2]);
    }),
  );

  it.effect("rejects a non-array", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(asJsonArray({ key: 1 }, "list"));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain("list must be a JSON array");
    }),
  );
});
