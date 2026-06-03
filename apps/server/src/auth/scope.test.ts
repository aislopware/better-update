import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";
import { AuthContext } from "./context";
import { assertPermissionOn } from "./scope";

import type { EnvironmentGrantModel, GrantEffect } from "../authz-models";
import type { EffectivePermissions } from "./context";

// The single permission token exercised by every truth-table row.
const RESOURCE = "update" as const;
const ACTION = "create" as const;
const TOKEN = `${RESOURCE}:${ACTION}`;

const SCOPE = { scopeKind: "channel", scopeId: "channel-1" } as const;

const MEMBER_ID = "member-1";
const ORG_ID = "org-1";

// `effectivePermissions` shape for the two baseline states under test.
const baselineAllows: EffectivePermissions = { update: ["create", "read"] };
const baselineDenies: EffectivePermissions = { update: ["read"] };

// A single canned grant on the scope under test.
const grant = (effect: GrantEffect, actions: readonly string[]): EnvironmentGrantModel => ({
  id: `grant-${effect}`,
  organizationId: ORG_ID,
  memberId: MEMBER_ID,
  scopeKind: "channel",
  scopeId: SCOPE.scopeId,
  effect,
  actions,
  createdAt: "2026-06-03T00:00:00.000Z",
});

const provideActor = (params: {
  readonly memberId: string | null;
  readonly effectivePermissions: EffectivePermissions;
}) =>
  Effect.provideService(AuthContext, {
    userId: params.memberId === null ? null : "user-1",
    organizationId: ORG_ID,
    memberId: params.memberId,
    role: params.memberId === null ? null : "developer",
    effectivePermissions: params.effectivePermissions,
    source: params.memberId === null ? "api-key" : "session",
    transport: "bearer",
    actorEmail: params.memberId === null ? "api-key" : "test@example.com",
    isSuperadmin: false,
  });

// Stub grant repo. `findForMemberOnScope` returns the canned grants; the other
// port methods are never reached by `assertPermissionOn`. `onLookup` records the
// scope a lookup was made for, letting api-key rows assert the repo is untouched.
const provideGrantRepo = (
  grants: readonly EnvironmentGrantModel[],
  onLookup?: (scopeId: string) => void,
) =>
  Effect.provideService(EnvironmentGrantRepo, {
    findForMemberOnScope: (lookup) => {
      onLookup?.(lookup.scopeId);
      return Effect.succeed(grants);
    },
    findByScope: () => Effect.succeed([]),
    findForMemberByScopeKind: () => Effect.succeed([]),
    upsert: () => Effect.succeed(grant("allow", []) satisfies EnvironmentGrantModel),
    deleteForMemberOnScope: () => Effect.void,
    deleteByScope: () => Effect.void,
  });

const run = (params: {
  readonly memberId: string | null;
  readonly effectivePermissions: EffectivePermissions;
  readonly grants: readonly EnvironmentGrantModel[];
  readonly onLookup?: (scopeId: string) => void;
}) =>
  assertPermissionOn(RESOURCE, ACTION, SCOPE).pipe(
    provideGrantRepo(params.grants, params.onLookup),
    provideActor({ memberId: params.memberId, effectivePermissions: params.effectivePermissions }),
    Effect.exit,
  );

describe("assertPermissionOn deny-wins resolution (member principal)", () => {
  it.effect("deny wins over an allowing baseline", () =>
    Effect.gen(function* () {
      const exit = yield* run({
        memberId: MEMBER_ID,
        effectivePermissions: baselineAllows,
        grants: [grant("deny", [TOKEN])],
      });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({
          _tag: "Forbidden",
          message: `Denied by scope grant: ${TOKEN}`,
        });
      }
    }),
  );

  it.effect("allows when the role baseline grants it and no deny applies", () =>
    Effect.gen(function* () {
      const exit = yield* run({
        memberId: MEMBER_ID,
        effectivePermissions: baselineAllows,
        grants: [],
      });
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("an allow grant adds permission the baseline lacks", () =>
    Effect.gen(function* () {
      const exit = yield* run({
        memberId: MEMBER_ID,
        effectivePermissions: baselineDenies,
        grants: [grant("allow", [TOKEN])],
      });
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("default deny when neither baseline nor any allow grant matches", () =>
    Effect.gen(function* () {
      const exit = yield* run({
        memberId: MEMBER_ID,
        effectivePermissions: baselineDenies,
        grants: [],
      });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({
          _tag: "Forbidden",
          message: `Insufficient permission: ${TOKEN}`,
        });
      }
    }),
  );

  it.effect("deny beats an allow grant on the same scope", () =>
    Effect.gen(function* () {
      const exit = yield* run({
        memberId: MEMBER_ID,
        effectivePermissions: baselineDenies,
        grants: [grant("deny", [TOKEN]), grant("allow", [TOKEN])],
      });
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({
          _tag: "Forbidden",
          message: `Denied by scope grant: ${TOKEN}`,
        });
      }
    }),
  );

  it.effect("baseline allows even with a redundant allow grant present", () =>
    Effect.gen(function* () {
      const exit = yield* run({
        memberId: MEMBER_ID,
        effectivePermissions: baselineAllows,
        grants: [grant("allow", [TOKEN])],
      });
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("a deny grant for a DIFFERENT action does not block this token", () =>
    Effect.gen(function* () {
      const exit = yield* run({
        memberId: MEMBER_ID,
        effectivePermissions: baselineAllows,
        grants: [grant("deny", ["rollout:update"])],
      });
      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );
});

describe("assertPermissionOn api-key principal (grants ignored)", () => {
  it.effect("allows on baseline and never touches the grant repo", () =>
    Effect.gen(function* () {
      let lookups = 0;
      const exit = yield* run({
        memberId: null,
        effectivePermissions: baselineAllows,
        // Even a matching deny grant would be ignored — but the repo must not be
        // consulted at all for an api-key principal.
        grants: [grant("deny", [TOKEN])],
        onLookup: () => {
          lookups += 1;
        },
      });
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(lookups).toBe(0);
    }),
  );

  it.effect("forbids when baseline lacks the token, without consulting grants", () =>
    Effect.gen(function* () {
      let lookups = 0;
      const exit = yield* run({
        memberId: null,
        effectivePermissions: baselineDenies,
        // A matching allow grant would let a member through, but api keys ignore
        // grants entirely.
        grants: [grant("allow", [TOKEN])],
        onLookup: () => {
          lookups += 1;
        },
      });
      expect(Exit.isFailure(exit)).toBe(true);
      expect(lookups).toBe(0);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toMatchObject({
          _tag: "Forbidden",
          message: `Insufficient permission: ${TOKEN}`,
        });
      }
    }),
  );
});
