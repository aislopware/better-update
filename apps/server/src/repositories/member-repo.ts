import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

// -- MemberRepo: membership-meta reads --------------------------------------

/** A member's identity within an org, as needed by the remove-member guard. */
export interface MemberRow {
  readonly id: string;
  /** Membership role — `owner | member` in the unified IAM model. */
  readonly role: string;
}

export interface MemberRepository {
  /**
   * The organization id a `member.id` belongs to, or `null` when no such member
   * exists. Used by the policy-attachment handler to confirm a principal is a
   * member of the acting org before attaching a policy.
   */
  readonly findOrgId: (params: { readonly memberId: string }) => Effect.Effect<string | null>;

  /**
   * Look up a member by id, scoped to its org so no caller can inspect another
   * org's membership. Returns `null` when the id is absent in this org.
   */
  readonly findInOrg: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<MemberRow | null>;

  /**
   * Count the org's owners (`member.role === "owner"`). Used by the remove guard
   * to reject removing the LAST owner — forward-compatible with a future
   * ownership-transfer flow that could create a second owner.
   */
  readonly countOwners: (params: { readonly organizationId: string }) => Effect.Effect<number>;

  /**
   * Delete a member, scoped to its org so no caller can remove another org's
   * member. Returns `false` when the id is absent in this org.
   */
  readonly remove: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<boolean>;
}

export class MemberRepo extends Context.Tag("api/MemberRepo")<MemberRepo, MemberRepository>() {}

interface MemberOrgRow {
  organization_id: string;
}

interface MemberIdRoleRow {
  id: string;
  role: string;
}

interface OwnerCountRow {
  owner_count: number;
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

  findInOrg: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT "id", "role" FROM "member" WHERE "id" = ? AND "organization_id" = ?`)
          .bind(params.id, params.organizationId)
          .first<MemberIdRoleRow>(),
      );
      return row === null ? null : { id: row.id, role: row.role };
    }),

  countOwners: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT COUNT(*) AS owner_count FROM "member" WHERE "organization_id" = ? AND "role" = 'owner'`,
        )
          .bind(params.organizationId)
          .first<OwnerCountRow>(),
      );
      return row === null ? 0 : row.owner_count;
    }),

  remove: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.prepare(`DELETE FROM "member" WHERE "id" = ? AND "organization_id" = ?`)
          .bind(params.id, params.organizationId)
          .run(),
      );
      return result.meta.changes > 0;
    }),
});
