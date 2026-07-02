import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

// -- Port ------------------------------------------------------------------
// Access grants carried by an invitation and applied when it is accepted
// (docs/specs/authz/ROLES-CAPABILITIES-SPEC.md §8d). `policyId` follows the
// policy_attachment grammar (managed, parameterized managed, or real policy
// id). Rows are consumed (deleted) on accept and swept on cancel/expiry.

export interface InvitationGrantRepository {
  readonly setForInvitation: (params: {
    readonly invitationId: string;
    readonly organizationId: string;
    readonly policyIds: readonly string[];
    readonly createdAt: string;
  }) => Effect.Effect<void>;

  readonly listForInvitation: (params: {
    readonly invitationId: string;
    readonly organizationId: string;
  }) => Effect.Effect<readonly string[]>;

  readonly deleteForInvitation: (params: { readonly invitationId: string }) => Effect.Effect<void>;
}

export class InvitationGrantRepo extends Context.Tag("api/InvitationGrantRepo")<
  InvitationGrantRepo,
  InvitationGrantRepository
>() {}

// -- D1 Adapter ------------------------------------------------------------

export const InvitationGrantRepoLive = Layer.succeed(InvitationGrantRepo, {
  setForInvitation: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () => {
        await db
          .deleteFrom("invitation_grant")
          .where("invitation_id", "=", params.invitationId)
          .execute();
        if (params.policyIds.length === 0) {
          return;
        }
        await db
          .insertInto("invitation_grant")
          .values(
            params.policyIds.map((policyId) => ({
              invitation_id: params.invitationId,
              organization_id: params.organizationId,
              policy_id: policyId,
              created_at: params.createdAt,
            })),
          )
          .execute();
      });
    }),

  listForInvitation: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("invitation_grant")
          .select("policy_id")
          .where("invitation_id", "=", params.invitationId)
          .where("organization_id", "=", params.organizationId)
          .orderBy("policy_id", "asc")
          .execute(),
      );
      return rows.map((row) => row.policy_id);
    }),

  deleteForInvitation: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("invitation_grant")
          .where("invitation_id", "=", params.invitationId)
          .execute(),
      );
    }),
});
