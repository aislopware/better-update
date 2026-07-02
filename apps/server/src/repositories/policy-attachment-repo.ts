import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";

import type { PolicyAttachment } from "../db/schema";
import type { PolicyAttachmentModel, PrincipalType } from "../models";

// -- Port -------------------------------------------------------------------

export interface PrincipalRef {
  readonly type: PrincipalType;
  readonly id: string;
}

export interface PolicyAttachmentRepository {
  /**
   * Every attachment for a set of principals (a member + its groups, or one api
   * key). Single OR-query; callers chunk large principal sets if needed.
   */
  readonly findForPrincipals: (params: {
    readonly organizationId: string;
    readonly principals: readonly PrincipalRef[];
  }) => Effect.Effect<readonly PolicyAttachmentModel[]>;

  /** All attachments on one principal (for the attach/detach UI). */
  readonly listForPrincipal: (params: {
    readonly organizationId: string;
    readonly principal: PrincipalRef;
  }) => Effect.Effect<readonly PolicyAttachmentModel[]>;

  /** Every attachment in an org (small table) — feeds the access-summaries endpoint. */
  readonly listByOrg: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly PolicyAttachmentModel[]>;

  /** Idempotent attach (one row per (policy, principal)). */
  readonly attach: (params: {
    readonly organizationId: string;
    readonly policyId: string;
    readonly principal: PrincipalRef;
  }) => Effect.Effect<void>;

  readonly detach: (params: {
    readonly organizationId: string;
    readonly policyId: string;
    readonly principal: PrincipalRef;
  }) => Effect.Effect<void>;
}

export class PolicyAttachmentRepo extends Context.Tag("api/PolicyAttachmentRepo")<
  PolicyAttachmentRepo,
  PolicyAttachmentRepository
>() {}

// -- D1 Adapter -------------------------------------------------------------

const COLUMNS = [
  "id",
  "organization_id",
  "policy_id",
  "principal_type",
  "principal_id",
  "created_at",
] as const;

type AttachmentRow = Pick<Selectable<PolicyAttachment>, (typeof COLUMNS)[number]>;

const toModel = (row: AttachmentRow): PolicyAttachmentModel => ({
  id: row.id,
  organizationId: row.organization_id,
  policyId: row.policy_id,
  principalType: row.principal_type,
  principalId: row.principal_id,
  createdAt: row.created_at,
});

export const PolicyAttachmentRepoLive = Layer.succeed(PolicyAttachmentRepo, {
  findForPrincipals: (params) =>
    Effect.gen(function* () {
      if (params.principals.length === 0) {
        return [];
      }
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("policy_attachment")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where((eb) =>
            eb.or(
              params.principals.map((principal) =>
                eb.and([
                  eb("principal_type", "=", principal.type),
                  eb("principal_id", "=", principal.id),
                ]),
              ),
            ),
          )
          .execute(),
      );
      return rows.map(toModel);
    }),

  listForPrincipal: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("policy_attachment")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .where("principal_type", "=", params.principal.type)
          .where("principal_id", "=", params.principal.id)
          .orderBy("created_at", "asc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  listByOrg: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("policy_attachment")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .execute(),
      );
      return rows.map(toModel);
    }),

  attach: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      yield* Effect.promise(async () =>
        db
          .insertInto("policy_attachment")
          .values({
            id,
            organization_id: params.organizationId,
            policy_id: params.policyId,
            principal_type: params.principal.type,
            principal_id: params.principal.id,
            created_at: now,
          })
          .onConflict((oc) =>
            oc
              .columns(["organization_id", "policy_id", "principal_type", "principal_id"])
              .doNothing(),
          )
          .execute(),
      );
    }),

  detach: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .deleteFrom("policy_attachment")
          .where("organization_id", "=", params.organizationId)
          .where("policy_id", "=", params.policyId)
          .where("principal_type", "=", params.principal.type)
          .where("principal_id", "=", params.principal.id)
          .execute(),
      );
    }),
});
