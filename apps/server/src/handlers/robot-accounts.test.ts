import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";
import type { PolicyStatement } from "../authz-models";

// The robot-accounts handlers gate every action with
// `assertAccess("robotAccount", <action>)` at the default (org) target. This
// pins THAT contract: an org member can mint/list/rotate/revoke robot accounts
// WITHOUT being the better-auth org owner — purely by holding a `robotAccount:*`
// allow via a policy attachment. We exercise the gate directly with a synthetic
// principal (the handlers' only authz dependency), mirroring `auth/policy.test.ts`.

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
  role: "member",
  isOwner: false,
  effectiveStatements: [],
  source: "session",
  transport: "cookie",
  sessionId: "sess-test",
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

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe("robot-accounts authz gate — assertAccess('robotAccount', …)", () => {
  it.effect("the better-auth org owner bypasses (can mint even with no statements)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create").pipe(provide({ isOwner: true })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect(
    "a member with an org-wide robotAccount:create allow ('*') can mint — NOT just the owner",
    () =>
      Effect.gen(function* () {
        const forbidden = yield* isForbidden(
          assertAccess("robotAccount", "create").pipe(
            provide({ effectiveStatements: [allow(["robotAccount:create"], ["*"])] }),
          ),
        );
        expect(forbidden).toBe(false);
      }),
  );

  it.effect("an 'org'-scoped robotAccount:* allow also grants mint (org target path)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create").pipe(
          provide({ effectiveStatements: [allow(["robotAccount:*"], ["org"])] }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("a member with NO robotAccount statement is denied (default-deny)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create").pipe(provide({})),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("a robotAccount:read allow does NOT grant create (action is scoped)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("robotAccount", "create").pipe(
          provide({ effectiveStatements: [allow(["robotAccount:read"], ["*"])] }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("read + delete are independently gated under the robotAccount resource", () =>
    Effect.gen(function* () {
      const canRead = yield* isForbidden(
        assertAccess("robotAccount", "read").pipe(
          provide({ effectiveStatements: [allow(["robotAccount:read"], ["*"])] }),
        ),
      );
      const canDelete = yield* isForbidden(
        assertAccess("robotAccount", "delete").pipe(
          provide({ effectiveStatements: [allow(["robotAccount:delete"], ["*"])] }),
        ),
      );
      // read-only principal cannot delete
      const readOnlyCanDelete = yield* isForbidden(
        assertAccess("robotAccount", "delete").pipe(
          provide({ effectiveStatements: [allow(["robotAccount:read"], ["*"])] }),
        ),
      );
      expect(canRead).toBe(false);
      expect(canDelete).toBe(false);
      expect(readOnlyCanDelete).toBe(true);
    }),
  );
});
