import { it } from "@effect/vitest";
import { Effect } from "effect";

import { AuthContext } from "../auth/context";
import { buildEnvVarScopeId, ENV_VAR_SCOPE_KIND } from "../auth/scope";
import { EnvironmentGrantRepo } from "../repositories/environment-grant-repo";
import { resolveEnvReadPredicate } from "./env-vars-helpers";

import type { EffectivePermissions } from "../auth/context";
import type { EnvironmentGrantModel, GrantEffect } from "../authz-models";
import type { EnvVarEnvironment } from "../models";

// `resolveEnvReadPredicate` resolves the actor's per (project × environment)
// env-var READ access ONCE into an in-memory predicate. It yields `CurrentActor`
// (derived from `AuthContext`) + `EnvironmentGrantRepo`. We stub both via
// `Effect.provideService` — no `vi.mock` — mirroring `auth/scope.test.ts`.

const ORG_ID = "org-1";
const MEMBER_ID = "member-1";
const PROJ_A = "proj-a";
const PROJ_B = "proj-b";
const READ_TOKEN = "envVar:read";

// Baselines: `envVar:read` present (allows) vs absent (denies).
const baselineAllows: EffectivePermissions = { envVar: ["read", "create"] };
const baselineDenies: EffectivePermissions = { envVar: ["create"] };

// A canned grant on a (project-or-global × environment) scope for `envVar:read`.
const grantOn = (
  projectId: string | null,
  environment: EnvVarEnvironment,
  effect: GrantEffect,
  actions: readonly string[] = [READ_TOKEN],
): EnvironmentGrantModel => ({
  id: `grant-${effect}-${projectId ?? "global"}-${environment}`,
  organizationId: ORG_ID,
  memberId: MEMBER_ID,
  scopeKind: ENV_VAR_SCOPE_KIND,
  scopeId: buildEnvVarScopeId(projectId, environment),
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

// Full port stub. `findForMemberByScopeKind` returns the canned grants and records
// each call via `onLookup`, so the api-key path can assert the repo is untouched.
const provideGrantRepo = (grants: readonly EnvironmentGrantModel[], onLookup?: () => void) =>
  Effect.provideService(EnvironmentGrantRepo, {
    findForMemberByScopeKind: () => {
      onLookup?.();
      return Effect.succeed(grants);
    },
    findForMemberOnScope: () => Effect.succeed([]),
    findByScope: () => Effect.succeed([]),
    upsert: () => Effect.succeed(grantOn(PROJ_A, "development", "allow")),
    deleteForMemberOnScope: () => Effect.void,
    deleteByScope: () => Effect.void,
  });

const resolve = (params: {
  readonly memberId: string | null;
  readonly effectivePermissions: EffectivePermissions;
  readonly grants: readonly EnvironmentGrantModel[];
  readonly onLookup?: () => void;
}) =>
  resolveEnvReadPredicate().pipe(
    provideGrantRepo(params.grants, params.onLookup),
    provideActor({ memberId: params.memberId, effectivePermissions: params.effectivePermissions }),
  );

describe("resolveEnvReadPredicate deny-wins (member principal)", () => {
  it.effect("baseline allows + no grants -> readable for every (project, env)", () =>
    Effect.gen(function* () {
      const isReadable = yield* resolve({
        memberId: MEMBER_ID,
        effectivePermissions: baselineAllows,
        grants: [],
      });
      expect(isReadable(PROJ_A, "production")).toBe(true);
      expect(isReadable(PROJ_B, "development")).toBe(true);
      expect(isReadable(null, "preview")).toBe(true);
    }),
  );

  it.effect("baseline allows + deny on (projA, production) -> only that scope blocked", () =>
    Effect.gen(function* () {
      const isReadable = yield* resolve({
        memberId: MEMBER_ID,
        effectivePermissions: baselineAllows,
        grants: [grantOn(PROJ_A, "production", "deny")],
      });
      expect(isReadable(PROJ_A, "production")).toBe(false);
      // Same project, different environment is untouched.
      expect(isReadable(PROJ_A, "development")).toBe(true);
      // Different project, same environment is untouched.
      expect(isReadable(PROJ_B, "production")).toBe(true);
    }),
  );

  it.effect("baseline denies + allow on (projA, development) -> readable only there", () =>
    Effect.gen(function* () {
      const isReadable = yield* resolve({
        memberId: MEMBER_ID,
        effectivePermissions: baselineDenies,
        grants: [grantOn(PROJ_A, "development", "allow")],
      });
      expect(isReadable(PROJ_A, "development")).toBe(true);
      // No grant + no baseline -> not readable.
      expect(isReadable(PROJ_A, "production")).toBe(false);
      expect(isReadable(PROJ_B, "development")).toBe(false);
    }),
  );

  it.effect("global sentinel: deny on (null, production) blocks global production only", () =>
    Effect.gen(function* () {
      const isReadable = yield* resolve({
        memberId: MEMBER_ID,
        effectivePermissions: baselineAllows,
        grants: [grantOn(null, "production", "deny")],
      });
      // Global scope keys on the sentinel via buildEnvVarScopeId(null, ...).
      expect(isReadable(null, "production")).toBe(false);
      // Other global environments follow the baseline (allow).
      expect(isReadable(null, "development")).toBe(true);
      // A real project with the same environment is unaffected by the global deny.
      expect(isReadable(PROJ_A, "production")).toBe(true);
    }),
  );

  it.effect("deny beats allow on the SAME scope", () =>
    Effect.gen(function* () {
      const isReadable = yield* resolve({
        memberId: MEMBER_ID,
        effectivePermissions: baselineDenies,
        grants: [grantOn(PROJ_A, "production", "allow"), grantOn(PROJ_A, "production", "deny")],
      });
      expect(isReadable(PROJ_A, "production")).toBe(false);
    }),
  );

  it.effect("a grant whose actions lack envVar:read does not flip the cell", () =>
    Effect.gen(function* () {
      const isReadable = yield* resolve({
        memberId: MEMBER_ID,
        effectivePermissions: baselineDenies,
        // An allow grant for a non-read token must not grant read access.
        grants: [grantOn(PROJ_A, "production", "allow", ["envVar:update"])],
      });
      expect(isReadable(PROJ_A, "production")).toBe(false);
    }),
  );
});

describe("resolveEnvReadPredicate api-key principal (grants ignored, baseline only)", () => {
  it.effect("baseline allows -> readable everywhere, repo never queried", () =>
    Effect.gen(function* () {
      let lookups = 0;
      const isReadable = yield* resolve({
        memberId: null,
        effectivePermissions: baselineAllows,
        // Even a matching deny grant must be ignored for an api-key principal.
        grants: [grantOn(PROJ_A, "production", "deny")],
        onLookup: () => {
          lookups += 1;
        },
      });
      expect(isReadable(PROJ_A, "production")).toBe(true);
      expect(isReadable(null, "development")).toBe(true);
      expect(lookups).toBe(0);
    }),
  );

  it.effect("baseline denies -> readable nowhere, repo never queried", () =>
    Effect.gen(function* () {
      let lookups = 0;
      const isReadable = yield* resolve({
        memberId: null,
        effectivePermissions: baselineDenies,
        // A matching allow grant would let a member through, but api keys ignore
        // grants entirely.
        grants: [grantOn(PROJ_A, "production", "allow")],
        onLookup: () => {
          lookups += 1;
        },
      });
      expect(isReadable(PROJ_A, "production")).toBe(false);
      expect(isReadable(null, "production")).toBe(false);
      expect(lookups).toBe(0);
    }),
  );
});
