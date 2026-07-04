import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";

// The organization-update handler gates on `assertAccess("organization","update")`
// at the org target. Under GitLab-RBAC this is an ORG-ADMIN rule (spec §2,
// owner decision 2026-07-03): owner/superadmin bypass, admins may update,
// plain members may only read. Org CREATE + DELETE stay on better-auth.

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  orgRole: "member",
  isOwner: false,
  projectRoles: {},
  source: "session",
  transport: "cookie",
  sessionId: "sess-test",
  actorEmail: "user@example.com",
  isSuperadmin: false,
  robotId: null,
};

const provide = (overrides: Partial<AuthContextShape>) =>
  Effect.provideService(AuthContext, { ...baseActor, ...overrides });

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe("organization update authz gate — assertAccess('organization','update')", () => {
  it.effect("the org owner bypasses", () =>
    Effect.gen(function* () {
      expect(
        yield* isForbidden(
          assertAccess("organization", "update").pipe(provide({ isOwner: true, orgRole: "owner" })),
        ),
      ).toBe(false);
    }),
  );

  it.effect("a platform superadmin bypasses too", () =>
    Effect.gen(function* () {
      expect(
        yield* isForbidden(
          assertAccess("organization", "update").pipe(provide({ isSuperadmin: true })),
        ),
      ).toBe(false);
    }),
  );

  it.effect("an org admin can update org settings", () =>
    Effect.gen(function* () {
      expect(
        yield* isForbidden(
          assertAccess("organization", "update").pipe(provide({ orgRole: "admin" })),
        ),
      ).toBe(false);
    }),
  );

  it.effect("a plain member is denied (default-deny)", () =>
    Effect.gen(function* () {
      expect(yield* isForbidden(assertAccess("organization", "update").pipe(provide({})))).toBe(
        true,
      );
    }),
  );

  it.effect("organization:read stays open to every member", () =>
    Effect.gen(function* () {
      expect(yield* isForbidden(assertAccess("organization", "read").pipe(provide({})))).toBe(
        false,
      );
    }),
  );
});
