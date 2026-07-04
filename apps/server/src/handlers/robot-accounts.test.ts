import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";

// Robots are PROJECT-scoped (GITLAB-RBAC-SPEC §1b, v2): the handlers gate
// every action with `assertAccess("robotAccount", <action>, {kind:"project"})`
// on the robot's project — Maintainer+ there (or org admin/owner via the
// implicit-maintainer rule). Legacy NULL-project rows fall back to
// assertOrgAdmin inside the handler.

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

const PROJECT = { kind: "project", projectId: "projA" } as const;

describe("robot-accounts authz gate — assertAccess('robotAccount', …, project)", () => {
  it.effect("the org owner bypasses", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create", PROJECT).pipe(
          provide({ isOwner: true, orgRole: "owner" }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("an org admin is an implicit maintainer on every project", () =>
    Effect.gen(function* () {
      for (const action of ["create", "read", "update", "delete"] as const) {
        const forbidden = yield* isForbidden(
          assertAccess("robotAccount", action, PROJECT).pipe(provide({ orgRole: "admin" })),
        );
        expect(forbidden).toBe(false);
      }
    }),
  );

  it.effect("the project's Maintainer manages its robots (GitLab token shape)", () =>
    Effect.gen(function* () {
      for (const action of ["create", "read", "update", "delete"] as const) {
        const forbidden = yield* isForbidden(
          assertAccess("robotAccount", action, PROJECT).pipe(
            provide({ projectRoles: { projA: "maintainer" } }),
          ),
        );
        expect(forbidden).toBe(false);
      }
    }),
  );

  it.effect("a developer on the project is denied (below maintainer)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create", PROJECT).pipe(
          provide({ projectRoles: { projA: "developer" } }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("maintainership on a DIFFERENT project confers nothing", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create", PROJECT).pipe(
          provide({ projectRoles: { projB: "maintainer" } }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("the org-target form is default-deny (no org-level robots anymore)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create").pipe(provide({ orgRole: "admin" })),
      );
      expect(forbidden).toBe(true);
    }),
  );
});
