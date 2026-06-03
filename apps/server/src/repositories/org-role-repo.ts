import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

import type { Action, Resource } from "../models";

// -- OrgRoleRepo: custom-role permission reads ------------------------------

export interface OrgRoleRepository {
  /**
   * One org's custom role permission map by role NAME (lowercased). `null` when no
   * matching `organization_role` row exists. Consumed by `auth/middleware.ts` to
   * resolve `effectivePermissions` for a member whose role is a custom (non
   * built-in) name.
   */
  readonly findByName: (params: {
    readonly organizationId: string;
    readonly role: string;
  }) => Effect.Effect<Partial<Record<Resource, readonly Action[]>> | null>;
}

export class OrgRoleRepo extends Context.Tag("api/OrgRoleRepo")<OrgRoleRepo, OrgRoleRepository>() {}

interface OrgRolePermissionRow {
  permission: string;
}

const parsePermission = (raw: string): Partial<Record<Resource, readonly Action[]>> =>
  // better-auth stored a JSON Record<string, string[]> built from our own
  // resource/action strings; the cast back to the typed shape is safe.
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- JSON column round-trips our own resource/action vocabulary
  JSON.parse(raw) as Partial<Record<Resource, readonly Action[]>>;

export const OrgRoleRepoLive = Layer.succeed(OrgRoleRepo, {
  findByName: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "permission" FROM "organization_role" WHERE "organization_id" = ? AND "role" = ?`,
        )
          .bind(params.organizationId, params.role)
          .first<OrgRolePermissionRow>(),
      );
      if (row === null) {
        return null;
      }
      return parsePermission(row.permission);
    }),
});

// -- MemberRepo: membership-meta reads --------------------------------------

export interface MemberRepository {
  /**
   * The organization id a `member.id` belongs to, or `null` when no such member
   * exists. Used by the channel-grants handler to confirm a grant target is a
   * member of the acting org before writing a scoped grant.
   */
  readonly findOrgId: (params: { readonly memberId: string }) => Effect.Effect<string | null>;
}

export class MemberRepo extends Context.Tag("api/MemberRepo")<MemberRepo, MemberRepository>() {}

interface MemberOrgRow {
  organization_id: string;
}

export const MemberRepoLive = Layer.succeed(MemberRepo, {
  findOrgId: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "organization_id" FROM "member" WHERE "id" = ?`)
          .bind(params.memberId)
          .first<MemberOrgRow>(),
      );
      return row === null ? null : row.organization_id;
    }),
});
