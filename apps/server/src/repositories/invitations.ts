import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";

import type { Invitation } from "../db/schema";

// -- Port -------------------------------------------------------------------

// An organization invitation row, as surfaced by the IAM-gated
// create/list/cancel endpoints. Mirrors the `invitation` table columns the
// better-auth `organization` plugin's accept-invitation handler reads (status /
// expires_at / role / email). Lives here (not models.ts) since the repo +
// handler are its only consumers.
export interface InvitationModel {
  readonly id: string;
  readonly email: string;
  // The `invitation.role` column is nullable; the IAM-gated create path always
  // writes a non-null role ("member" by default), but list may surface legacy
  // better-auth-created rows, so the model carries the column's true nullability.
  readonly role: string | null;
  readonly status: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface CreateInvitationInput {
  readonly organizationId: string;
  readonly email: string;
  readonly role: string;
  /** A real `user.id` — the column FK-references `user(id)`. */
  readonly inviterUserId: string;
}

export interface InvitationRepository {
  /**
   * INSERT a pending invitation row compatible with better-auth's
   * accept-invitation handler: `status = "pending"`, a future `expires_at`
   * (48h, matching the plugin's `invitationExpiresIn` default), the recipient
   * `email`, the org id, the role, and the inviter's `user.id`. Dates are stored
   * as ISO 8601 strings — the format better-auth's sqlite adapter writes
   * (`supportsDates: false` → `Date.toISOString()`) and reads back via
   * `new Date(value)`, so `accept-invitation`'s `expiresAt`/`status` checks see
   * an identical shape.
   */
  readonly create: (params: CreateInvitationInput) => Effect.Effect<InvitationModel>;

  /** All invitations for an org, newest first (all statuses). */
  readonly list: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly InvitationModel[]>;

  /**
   * Cancel a pending invitation by id, scoped to its org so no caller can touch
   * another org's invite. Sets `status = "canceled"` (rather than deleting) so a
   * canceled invite fails better-auth's `status !== "pending"` accept guard while
   * the row stays visible in the list. Returns `false` when the id is absent in
   * this org or was not pending.
   */
  readonly cancel: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<boolean>;
}

export class InvitationRepo extends Context.Tag("api/InvitationRepo")<
  InvitationRepo,
  InvitationRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

// 48h, matching the better-auth `organization` plugin's `invitationExpiresIn`
// default (3600 * 48 seconds). Stored as an absolute ISO 8601 expiry.
const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

// Status set on cancel. better-auth's accept-invitation rejects anything whose
// status is not exactly "pending", so this verbatim string blocks acceptance.
const CANCELED_STATUS = "canceled";
const PENDING_STATUS = "pending";

const COLUMNS = ["id", "email", "role", "status", "expires_at", "created_at"] as const;

type InvitationRow = Pick<Selectable<Invitation>, (typeof COLUMNS)[number]>;

const toModel = (row: InvitationRow): InvitationModel => ({
  id: row.id,
  email: row.email,
  role: row.role,
  status: row.status,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

export const InvitationRepoLive = Layer.succeed(InvitationRepo, {
  create: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = crypto.randomUUID();
      const now = new Date();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS).toISOString();
      // Normalize to match better-auth's invite write path (it stores
      // email.toLowerCase()); accept compares emails case-insensitively, so
      // both write paths now persist identically-cased rows.
      const email = params.email.toLowerCase();

      const row = yield* Effect.promise(async () =>
        db
          .insertInto("invitation")
          .values({
            id,
            organization_id: params.organizationId,
            email,
            role: params.role,
            status: PENDING_STATUS,
            expires_at: expiresAt,
            created_at: createdAt,
            inviter_id: params.inviterUserId,
          })
          .returning(COLUMNS)
          .executeTakeFirst(),
      );

      return row === undefined
        ? { id, email, role: params.role, status: PENDING_STATUS, expiresAt, createdAt }
        : toModel(row);
    }),

  list: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("invitation")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .orderBy("created_at", "desc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  cancel: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .updateTable("invitation")
          .set({ status: CANCELED_STATUS })
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .where("status", "=", PENDING_STATUS)
          .returning(["id"])
          .executeTakeFirst(),
      );
      return row !== undefined;
    }),
});
