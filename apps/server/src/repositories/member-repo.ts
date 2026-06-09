import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

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

export const MemberRepoLive = Layer.succeed(MemberRepo, {
  findOrgId: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("member")
          .select("organization_id")
          .where("id", "=", params.memberId)
          .executeTakeFirst(),
      );
      return toDbNull(row?.organization_id);
    }),

  findInOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("member")
          .select(["id", "role"])
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return row ? { id: row.id, role: row.role } : null;
    }),

  countOwners: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("member")
          .where("organization_id", "=", params.organizationId)
          .where("role", "=", "owner")
          .select((eb) => eb.fn.countAll<number>().as("owner_count"))
          .executeTakeFirstOrThrow(),
      );
      return row.owner_count;
    }),

  remove: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const result = yield* Effect.promise(async () =>
        db
          .deleteFrom("member")
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return Number(result.numDeletedRows) > 0;
    }),
});
