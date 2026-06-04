import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { AuthContext } from "../auth/context";
import { assertAccess } from "../auth/policy";

import type { AuthContextShape } from "../auth/context";
import type { PolicyStatement } from "../authz-models";

// The api-keys handlers gate every action with `assertAccess("apiKey", <action>)`
// at the default (org) target. This pins THAT contract: the IAM `apiKey` resource
// token is now wired, so an org member can mint/list/revoke keys WITHOUT being the
// better-auth org owner — purely by holding an `apiKey:*` allow via a policy
// attachment. We exercise the gate directly with a synthetic principal (the
// handlers' only authz dependency), mirroring `auth/policy.test.ts`.

const baseActor: AuthContextShape = {
  userId: "u1",
  organizationId: "org-1",
  memberId: "m1",
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

const isForbidden = (effect: Effect.Effect<void, unknown>) =>
  Effect.gen(function* () {
    const exit = yield* effect.pipe(Effect.exit);
    return Exit.isFailure(exit);
  });

describe("api-keys authz gate — assertAccess('apiKey', …)", () => {
  it.effect("the better-auth org owner bypasses (can mint even with no statements)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("apiKey", "create").pipe(provide({ isOwner: true })),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect(
    "a member with an org-wide apiKey:create allow ('*') can mint — NOT just the owner",
    () =>
      Effect.gen(function* () {
        const forbidden = yield* isForbidden(
          assertAccess("apiKey", "create").pipe(
            provide({ effectiveStatements: [allow(["apiKey:create"], ["*"])] }),
          ),
        );
        expect(forbidden).toBe(false);
      }),
  );

  it.effect("an 'org'-scoped apiKey:* allow also grants mint (org target path)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("apiKey", "create").pipe(
          provide({ effectiveStatements: [allow(["apiKey:*"], ["org"])] }),
        ),
      );
      expect(forbidden).toBe(false);
    }),
  );

  it.effect("a member with NO apiKey statement is denied (default-deny)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(assertAccess("apiKey", "create").pipe(provide({})));
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("an apiKey:read allow does NOT grant create (action is scoped)", () =>
    Effect.gen(function* () {
      const forbidden = yield* isForbidden(
        assertAccess("apiKey", "create").pipe(
          provide({ effectiveStatements: [allow(["apiKey:read"], ["*"])] }),
        ),
      );
      expect(forbidden).toBe(true);
    }),
  );

  it.effect("read + delete are independently gated under the apiKey resource", () =>
    Effect.gen(function* () {
      const canRead = yield* isForbidden(
        assertAccess("apiKey", "read").pipe(
          provide({ effectiveStatements: [allow(["apiKey:read"], ["*"])] }),
        ),
      );
      const canDelete = yield* isForbidden(
        assertAccess("apiKey", "delete").pipe(
          provide({ effectiveStatements: [allow(["apiKey:delete"], ["*"])] }),
        ),
      );
      // read-only principal cannot delete
      const readOnlyCanDelete = yield* isForbidden(
        assertAccess("apiKey", "delete").pipe(
          provide({ effectiveStatements: [allow(["apiKey:read"], ["*"])] }),
        ),
      );
      expect(canRead).toBe(false);
      expect(canDelete).toBe(false);
      expect(readOnlyCanDelete).toBe(true);
    }),
  );
});
