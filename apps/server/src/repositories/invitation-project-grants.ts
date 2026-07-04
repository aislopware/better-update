import { Context, Effect, Layer } from "effect";

import { kyselyDb } from "../cloudflare/db";

import type { ProjectRole } from "../models";

// -- Port ------------------------------------------------------------------
// Project grants carried by a pending invitation (GITLAB-RBAC-SPEC §4c):
// validated against the INVITER at create time, materialized as
// project_member rows by the better-auth accept hook (auth/org-lifecycle.ts),
// swept on cancel/reject.

export interface InvitationProjectGrantModel {
  readonly projectId: string;
  readonly role: ProjectRole;
}

export interface InvitationProjectGrantRepository {
  /** Replace the invitation's grant set (idempotent write of the full list). */
  readonly setForInvitation: (params: {
    readonly invitationId: string;
    readonly organizationId: string;
    readonly grants: readonly InvitationProjectGrantModel[];
    readonly createdAt: string;
  }) => Effect.Effect<void>;

  readonly deleteForInvitation: (params: { readonly invitationId: string }) => Effect.Effect<void>;
}

export class InvitationProjectGrantRepo extends Context.Tag("api/InvitationProjectGrantRepo")<
  InvitationProjectGrantRepo,
  InvitationProjectGrantRepository
>() {}

// -- D1 Adapter --------------------------------------------------------------

export const InvitationProjectGrantRepoLive = Layer.succeed(InvitationProjectGrantRepo, {
  setForInvitation: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("invitation_project_grant")
          .where("invitation_id", "=", params.invitationId)
          .execute(),
      );
      if (params.grants.length === 0) {
        return;
      }
      yield* Effect.promise(async () =>
        db
          .insertInto("invitation_project_grant")
          .values(
            params.grants.map((grant) => ({
              invitation_id: params.invitationId,
              organization_id: params.organizationId,
              project_id: grant.projectId,
              role: grant.role,
              created_at: params.createdAt,
            })),
          )
          .execute(),
      );
    }),

  deleteForInvitation: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("invitation_project_grant")
          .where("invitation_id", "=", params.invitationId)
          .execute(),
      );
    }),
});
