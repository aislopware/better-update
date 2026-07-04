import { CreateInvitationBody } from "@better-update/api";
import { it } from "@effect/vitest";
import { Effect, Either, Exit, Schema } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";

// The invitations handlers gate list/create/cancel with
// `assertAccess("invitation", <action>)` at the default (org) target. Under
// GitLab-RBAC these are ORG-ADMIN rules (spec §2): owner/superadmin bypass,
// admins invite/cancel/list, plain members are denied. The owner-only
// admin-invite guard and the project-grant validation live in the handler
// (covered by integration/e2e).

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

describe("invitations authz gate — assertAccess('invitation', …)", () => {
  it.effect("the org owner bypasses (create + cancel)", () =>
    Effect.gen(function* () {
      const cannotCreate = yield* isForbidden(
        assertAccess("invitation", "create").pipe(provide({ isOwner: true, orgRole: "owner" })),
      );
      const cannotCancel = yield* isForbidden(
        assertAccess("invitation", "cancel").pipe(provide({ isOwner: true, orgRole: "owner" })),
      );
      expect(cannotCreate).toBe(false);
      expect(cannotCancel).toBe(false);
    }),
  );

  it.effect("a platform superadmin bypasses too", () =>
    Effect.gen(function* () {
      const cannotCreate = yield* isForbidden(
        assertAccess("invitation", "create").pipe(provide({ isSuperadmin: true })),
      );
      expect(cannotCreate).toBe(false);
    }),
  );

  it.effect("an org admin can create, cancel, and list invitations", () =>
    Effect.gen(function* () {
      for (const action of ["create", "cancel", "read"] as const) {
        const forbidden = yield* isForbidden(
          assertAccess("invitation", action).pipe(provide({ orgRole: "admin" })),
        );
        expect(forbidden).toBe(false);
      }
    }),
  );

  it.effect("a plain member is denied every invitation action (default-deny)", () =>
    Effect.gen(function* () {
      for (const action of ["create", "cancel", "read"] as const) {
        const forbidden = yield* isForbidden(assertAccess("invitation", action).pipe(provide({})));
        expect(forbidden).toBe(true);
      }
    }),
  );

  it.effect("project maintainership does NOT confer org-level inviting", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("invitation", "create").pipe(
          provide({ projectRoles: { projA: "maintainer" } }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );
});

describe("CreateInvitationBody payload", () => {
  const decode = Schema.decodeUnknownEither(CreateInvitationBody);

  it("accepts an email-only payload (role defaults server-side)", () => {
    expect(Either.isRight(decode({ email: "new@example.com" }))).toBe(true);
  });

  it("accepts member/admin roles and project grants", () => {
    const result = decode({
      email: "new@example.com",
      role: "admin",
      projects: [{ projectId: "p1", role: "developer" }],
    });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects owner as an invitable role and unknown project roles", () => {
    expect(Either.isLeft(decode({ email: "new@example.com", role: "owner" }))).toBe(true);
    expect(
      Either.isLeft(
        decode({ email: "new@example.com", projects: [{ projectId: "p1", role: "admin" }] }),
      ),
    ).toBe(true);
  });

  it("rejects malformed emails", () => {
    expect(Either.isLeft(decode({ email: "not-an-email" }))).toBe(true);
  });
});
