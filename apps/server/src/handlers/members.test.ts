import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";
import type { PolicyStatement } from "../authz-models";

// The members handler gates removal with `assertAccess("member", "delete")` at
// the default (org) target. This pins THAT contract: in the unified IAM model
// member removal flows through the policy model, NOT a role string. An org member
// can remove members WITHOUT being the better-auth owner — purely by holding a
// `member:delete` allow via a policy attachment (e.g. managed:admin); a member
// with no such allow is denied (default-deny). The last-owner guard is exercised
// against the repo separately; here we exercise the gate directly with a synthetic
// principal, mirroring `handlers/api-keys.test.ts` / `handlers/invitations.test.ts`.

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  // A non-"owner" role string. The gate ignores role entirely (owner.ts pins the
  // exact-equality bypass); the only role that grants anything is "owner".
  role: "member",
  isOwner: false,
  effectiveStatements: [],
  source: "session",
  transport: "cookie",
  actorEmail: "dev@example.com",
  isSuperadmin: false,
};

const provide = (overrides: Partial<AuthContextShape>) =>
  Effect.provideService(AuthContext, { ...baseActor, ...overrides });

const allow = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "allow",
  actions,
  resources,
});

const deny = (actions: string[], resources: string[]): PolicyStatement => ({
  effect: "deny",
  actions,
  resources,
});

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe("members authz gate — assertAccess('member', 'delete')", () => {
  it.effect("the better-auth org owner bypasses (can remove with no statements)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(provide({ isOwner: true })),
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

  it.effect(
    "a role-'member' principal holding member:delete via attachment can remove — NOT just the owner",
    () =>
      Effect.gen(function* () {
        const forbidden = yield* isForbidden(
          assertAccess("member", "delete").pipe(
            provide({ effectiveStatements: [allow(["member:delete"], ["*"])] }),
          ),
        );
        expect(forbidden).toBe(false);
      }),
  );

  it.effect("an 'org'-scoped member:* allow also grants delete (managed:admin shape)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(
          provide({ effectiveStatements: [allow(["member:*"], ["org"])] }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("a member with NO member statement is denied (default-deny)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(assertAccess("member", "delete").pipe(provide({})));
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("a member:read allow does NOT grant delete (action is scoped)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(
          provide({ effectiveStatements: [allow(["member:read"], ["*"])] }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("a deny on member:delete wins over an allow (deny-wins)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("member", "delete").pipe(
          provide({
            effectiveStatements: [allow(["member:*"], ["*"]), deny(["member:delete"], ["*"])],
          }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );
});
