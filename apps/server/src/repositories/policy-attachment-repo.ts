import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

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

interface AttachmentRow {
  id: string;
  organization_id: string;
  policy_id: string;
  principal_type: PrincipalType;
  principal_id: string;
  created_at: string;
}

const toModel = (row: AttachmentRow): PolicyAttachmentModel => ({
  id: row.id,
  organizationId: row.organization_id,
  policyId: row.policy_id,
  principalType: row.principal_type,
  principalId: row.principal_id,
  createdAt: row.created_at,
});

const COLUMNS = `"id", "organization_id", "policy_id", "principal_type", "principal_id", "created_at"`;

export const PolicyAttachmentRepoLive = Layer.succeed(PolicyAttachmentRepo, {
  findForPrincipals: (params) =>
    Effect.gen(function* () {
      if (params.principals.length === 0) {
        return [];
      }
      const env = yield* cloudflareEnv;
      const clause = params.principals
        .map(() => `("principal_type" = ? AND "principal_id" = ?)`)
        .join(" OR ");
      const binds = params.principals.flatMap((principal) => [principal.type, principal.id]);
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "policy_attachment" WHERE "organization_id" = ? AND (${clause})`,
        )
          .bind(params.organizationId, ...binds)
          .all<AttachmentRow>(),
      );
      return rows.results.map(toModel);
    }),

  listForPrincipal: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "policy_attachment" WHERE "organization_id" = ? AND "principal_type" = ? AND "principal_id" = ? ORDER BY "created_at" ASC`,
        )
          .bind(params.organizationId, params.principal.type, params.principal.id)
          .all<AttachmentRow>(),
      );
      return rows.results.map(toModel);
    }),

  attach: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "policy_attachment" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT ("organization_id", "policy_id", "principal_type", "principal_id") DO NOTHING`,
        )
          .bind(
            id,
            params.organizationId,
            params.policyId,
            params.principal.type,
            params.principal.id,
            now,
          )
          .run(),
      );
    }),

  detach: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `DELETE FROM "policy_attachment" WHERE "organization_id" = ? AND "policy_id" = ? AND "principal_type" = ? AND "principal_id" = ?`,
        )
          .bind(params.organizationId, params.policyId, params.principal.type, params.principal.id)
          .run(),
      );
    }),
});
