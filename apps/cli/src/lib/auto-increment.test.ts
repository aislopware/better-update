import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { bumpBuildNumber, bumpVersion, bumpVersionCode } from "./auto-increment";
import { BuildProfileError } from "./exit-codes";
import { failureError } from "./test-utils";

describe(bumpBuildNumber, () => {
  it.effect("increments a numeric string", () =>
    Effect.gen(function* () {
      expect(yield* bumpBuildNumber("1")).toBe("2");
      expect(yield* bumpBuildNumber("42")).toBe("43");
      expect(yield* bumpBuildNumber("999")).toBe("1000");
    }),
  );

  it.effect("treats undefined as starting from 0 (next is 1)", () =>
    Effect.gen(function* () {
      expect(yield* bumpBuildNumber(undefined)).toBe("1");
    }),
  );

  it.effect("fails on non-numeric input with a helpful message", () =>
    Effect.gen(function* () {
      const exit = yield* bumpBuildNumber("abc").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = failureError(exit);
        expect(error).toBeInstanceOf(BuildProfileError);
        expect(error?.message).toContain("not a base-10 integer");
      }
    }),
  );
});

describe(bumpVersionCode, () => {
  it.effect("increments an integer", () =>
    Effect.gen(function* () {
      expect(yield* bumpVersionCode(1)).toBe(2);
      expect(yield* bumpVersionCode(99)).toBe(100);
    }),
  );

  it.effect("treats undefined as 0 (next is 1)", () =>
    Effect.gen(function* () {
      expect(yield* bumpVersionCode(undefined)).toBe(1);
    }),
  );

  it.effect("fails on non-integer (decimal)", () =>
    Effect.gen(function* () {
      const exit = yield* bumpVersionCode(1.5).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)).toBeInstanceOf(BuildProfileError);
      }
    }),
  );

  it.effect("fails on negative", () =>
    Effect.gen(function* () {
      const exit = yield* bumpVersionCode(-1).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

describe(bumpVersion, () => {
  it.effect("bumps the patch on plain semver", () =>
    Effect.gen(function* () {
      expect(yield* bumpVersion("1.0.0")).toBe("1.0.1");
      expect(yield* bumpVersion("0.9.99")).toBe("0.9.100");
    }),
  );

  it.effect("preserves the pre-release / build suffix when present", () =>
    Effect.gen(function* () {
      expect(yield* bumpVersion("1.2.3-beta")).toBe("1.2.4-beta");
      expect(yield* bumpVersion("1.0.0-rc.1+abc")).toBe("1.0.1-rc.1+abc");
    }),
  );

  it.effect("fails when version is missing", () =>
    Effect.gen(function* () {
      const exit = yield* bumpVersion(undefined).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)?.message).toContain("no `version` field");
      }
    }),
  );

  it.effect("fails on non-semver input", () =>
    Effect.gen(function* () {
      const exit = yield* bumpVersion("not-a-version").pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(failureError(exit)?.message).toContain("not a semver");
      }
    }),
  );
});
