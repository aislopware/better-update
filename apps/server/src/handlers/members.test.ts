import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";

// The members handler gates removal with `assertAccess("member", "delete")` at
// the default (org) target. This pins THAT contract under GitLab-RBAC:
// member removal is an ORG-ADMIN rule (spec §2) — org admins and owners can
// remove; plain members (whatever their project roles) cannot. The last-owner
// and owner-removal guards are exercised in the handler/e2e suites.

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
  actorEmail: "dev@example.com",
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

describe("members authz gate — assertAccess('member', 'delete')", () => {
  it.effect("the org owner bypasses", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(provide({ isOwner: true, orgRole: "owner" })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("a platform superadmin bypasses too", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(provide({ isSuperadmin: true })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("an org admin can remove members", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(provide({ orgRole: "admin" })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("a plain member is denied (default-deny)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(assertAccess("member", "delete").pipe(provide({})));
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("project maintainership does NOT confer org member management", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(provide({ projectRoles: { projA: "maintainer" } })),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("member:read stays org-visible for every member", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(assertAccess("member", "read").pipe(provide({})));
      expect(forbidden).toBe(false);
    }),
  );
});
