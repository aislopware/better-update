import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";
import type { PolicyStatement } from "../authz-models";

// The organization-update handler gates on `assertAccess("organization","update")`
// at the org target — so renaming/re-slugging the active org now flows through the
// IAM gate, NOT better-auth's org-role AC. Owner/superadmin bypass; a non-owner
// needs an explicit organization:update allow via a policy attachment (the role
// string grants nothing). Org CREATE + DELETE stay on better-auth (see auth.ts).

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  isOwner: false,
  effectiveStatements: [],
  source: "session",
  transport: "cookie",
  actorEmail: "user@example.com",
  isSuperadmin: false,
};

const provide = (overrides: Partial<AuthContextShape>) =>
  Effect.provideService(AuthContext, { ...baseActor, ...overrides });

const allow = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "allow",
  actions,
  resources,
});

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe("organization update authz gate — assertAccess('organization','update')", () => {
  it.effect("the org owner bypasses (can update with no statements)", () =>
    Effect.gen(function* () {
      expect(
        yield* isForbidden(assertAccess("organization", "update").pipe(provide({ isOwner: true }))),
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

  it.effect("a non-owner with organization:update on org can update — NOT just the owner", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("organization", "update").pipe(
          provide({ effectiveStatements: [allow(["organization:update"], ["org"])] }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("a member with NO organization grant is denied (default-deny)", () =>
    Effect.gen(function* () {
      expect(yield* isForbidden(assertAccess("organization", "update").pipe(provide({})))).toBe(
        true,
      );
    }),
  );

  it.effect("an organization:read allow does NOT grant update (the admin-preset shape)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("organization", "update").pipe(
          provide({ effectiveStatements: [allow(["organization:read"], ["org"])] }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );
});
