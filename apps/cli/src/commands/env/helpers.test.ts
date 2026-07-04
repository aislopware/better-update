import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { failureError } from "../../lib/test-utils";
import { parseEnvironmentScopeArg } from "./helpers";

import type { BuildProfile } from "../../lib/build-profile";

const profileWith = (overrides: Partial<BuildProfile>): BuildProfile => ({
  name: "preview",
  environment: "preview",
  ...overrides,
});

describe(parseEnvironmentScopeArg, () => {
  it.effect("prefers an explicit environment over the profile's", () =>
    Effect.gen(function* () {
      expect(yield* parseEnvironmentScopeArg("staging", profileWith({}))).toBe("staging");
    }),
  );

  it.effect("falls back to the profile's environment, then production", () =>
    Effect.gen(function* () {
      expect(yield* parseEnvironmentScopeArg(undefined, profileWith({}))).toBe("preview");
      expect(yield* parseEnvironmentScopeArg(undefined, undefined)).toBe("production");
    }),
  );

  it.effect("attributes an invalid profile environment to its eas.json profile", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        parseEnvironmentScopeArg(undefined, profileWith({ environment: "Production" })),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain(
        'Invalid environment "Production" (from eas.json profile "preview")',
      );
    }),
  );

  it.effect("does not blame the profile for an invalid explicit environment", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(parseEnvironmentScopeArg("Bad Name", profileWith({})));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(failureError(exit)?.message).toContain('Invalid environment "Bad Name": must be');
    }),
  );
});
