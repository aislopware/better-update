import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "./context";
import { assertOrgOwnership, NotFound } from "./ownership";
import { permissions } from "./permissions";

const provideAuth = (organizationId: string) =>
  Effect.provideService(AuthContext, {
    userId: "test-user",
    organizationId,
    role: "owner",
    effectivePermissions: permissions.owner,
    source: "session",
  });

describe(assertOrgOwnership, () => {
  it.effect("succeeds when org IDs match", () =>
    assertOrgOwnership("org-1").pipe(provideAuth("org-1")),
  );

  it.effect("fails with NotFound when org IDs differ", () =>
    Effect.gen(function* () {
      const exit = yield* assertOrgOwnership("org-other").pipe(provideAuth("org-1"), Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = exit.cause.pipe((cause) => (cause._tag === "Fail" ? cause.error : undefined));
        expect(error).toBeInstanceOf(NotFound);
      }
    }),
  );

  it.effect("returns 'Resource not found' to prevent enumeration", () =>
    Effect.gen(function* () {
      const exit = yield* assertOrgOwnership("org-other").pipe(provideAuth("org-1"), Effect.exit);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error.message).toBe("Resource not found");
      }
    }),
  );
});
