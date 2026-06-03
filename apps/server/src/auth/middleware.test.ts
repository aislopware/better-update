import { it } from "@effect/vitest";
import { Effect } from "effect";

import { OrgRoleRepo } from "../repositories/org-role-repo";
import { resolveEffectivePermissions } from "./middleware";
import { permissions } from "./permissions";

import type { Action, Resource } from "../models";

const ORG_ID = "org-1";

// Stub `OrgRoleRepo` over a fixed name -> permission table. Records every lookup
// so tests can assert the zero-query built-in path.
const provideOrgRoleRepo = (
  table: Record<string, Partial<Record<Resource, readonly Action[]>>>,
  onLookup?: (role: string) => void,
) =>
  Effect.provideService(OrgRoleRepo, {
    findByName: (params) => {
      onLookup?.(params.role);
      return Effect.succeed(table[params.role] ?? null);
    },
  });

const sorted = (xs: readonly string[] | undefined): readonly string[] => [...(xs ?? [])].toSorted();

describe("resolveEffectivePermissions built-in role", () => {
  it.effect("maps a built-in role from the static permissions map", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveEffectivePermissions({
        organizationId: ORG_ID,
        roleSpec: "developer",
      }).pipe(provideOrgRoleRepo({}));

      for (const [resource, actions] of Object.entries(permissions.developer)) {
        expect(sorted(resolved[resource as Resource])).toStrictEqual(sorted(actions));
      }
      // No resources beyond the built-in map's keys.
      expect(sorted(Object.keys(resolved))).toStrictEqual(
        sorted(Object.keys(permissions.developer)),
      );
    }),
  );

  it.effect("never queries organization_role for a built-in role (zero-query path)", () =>
    Effect.gen(function* () {
      let lookups = 0;
      yield* resolveEffectivePermissions({ organizationId: ORG_ID, roleSpec: "owner" }).pipe(
        provideOrgRoleRepo({}, () => {
          lookups += 1;
        }),
      );
      expect(lookups).toBe(0);
    }),
  );
});

describe("resolveEffectivePermissions custom role", () => {
  const releaser: Partial<Record<Resource, readonly Action[]>> = {
    channel: ["read", "update"],
    rollout: ["read", "create", "update"],
  };

  it.effect("reads a custom role's permission map from the repo", () =>
    Effect.gen(function* () {
      let lookups = 0;
      const resolved = yield* resolveEffectivePermissions({
        organizationId: ORG_ID,
        roleSpec: "releaser",
      }).pipe(
        provideOrgRoleRepo({ releaser }, () => {
          lookups += 1;
        }),
      );

      expect(lookups).toBe(1);
      expect(sorted(resolved.channel)).toStrictEqual(["read", "update"]);
      expect(sorted(resolved.rollout)).toStrictEqual(["create", "read", "update"]);
      // Custom role grants nothing it did not declare.
      expect(sorted(Object.keys(resolved))).toStrictEqual(["channel", "rollout"]);
    }),
  );

  it.effect("an unknown role name (no row) resolves to no permissions", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveEffectivePermissions({
        organizationId: ORG_ID,
        roleSpec: "ghost",
      }).pipe(provideOrgRoleRepo({}));
      expect(Object.keys(resolved)).toStrictEqual([]);
    }),
  );

  it.effect("merges a built-in and a custom role (multi-role comma split, union of actions)", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveEffectivePermissions({
        organizationId: ORG_ID,
        roleSpec: "viewer, releaser",
      }).pipe(provideOrgRoleRepo({ releaser }));

      // viewer baseline grants read on many resources; releaser adds update on
      // channel + create/update on rollout. The merge is a per-resource union.
      expect(sorted(resolved.channel)).toStrictEqual(["read", "update"]);
      expect(sorted(resolved.rollout)).toStrictEqual(["create", "read", "update"]);
      // A viewer-only resource survives the merge unchanged.
      expect(sorted(resolved.organization)).toStrictEqual(["read"]);
    }),
  );

  it.effect("only the custom name in a mixed spec triggers a repo read", () =>
    Effect.gen(function* () {
      const queried: string[] = [];
      yield* resolveEffectivePermissions({
        organizationId: ORG_ID,
        roleSpec: "viewer,releaser",
      }).pipe(
        provideOrgRoleRepo({ releaser }, (role) => {
          queried.push(role);
        }),
      );
      // Built-in `viewer` short-circuits to the static map; only `releaser` is read.
      expect(queried).toStrictEqual(["releaser"]);
    }),
  );
});
