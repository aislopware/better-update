import { it } from "@effect/vitest";
import { Effect } from "effect";

import { parseProjectRole } from "./project-roles";

describe(parseProjectRole, () => {
  it.effect("defaults to developer when omitted or blank", () =>
    Effect.gen(function* () {
      expect(yield* parseProjectRole(undefined)).toBe("developer");
      expect(yield* parseProjectRole("  ")).toBe("developer");
    }),
  );

  it.effect("accepts every project role, trimming whitespace", () =>
    Effect.gen(function* () {
      expect(yield* parseProjectRole("maintainer")).toBe("maintainer");
      expect(yield* parseProjectRole(" developer ")).toBe("developer");
      expect(yield* parseProjectRole("reporter")).toBe("reporter");
    }),
  );

  it.effect("rejects anything outside the ladder", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseProjectRole("admin"));
      expect(error._tag).toBe("InvalidArgumentError");
      expect(error.message).toContain("maintainer|developer|reporter");
    }),
  );
});
