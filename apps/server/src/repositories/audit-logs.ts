import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

import type { AuditLogModel, AuditLogResourceType } from "../models";

// -- Row type ----------------------------------------------------------------

export interface AuditLogRow {
  readonly id: string;
  readonly organization_id: string;
  readonly actor_id: string | null;
  readonly actor_email: string;
  readonly action: string;
  readonly resource_type:
    | "project"
    | "branch"
    | "channel"
    | "update"
    | "build"
    | "credential"
    | "envVar";
  readonly resource_id: string | null;
  readonly metadata: string | null;
  readonly source: "session" | "api-key";
  readonly created_at: string;
}

// -- Port --------------------------------------------------------------------

export interface AuditLogRepository {
  readonly insert: (params: {
    readonly id: string;
    readonly organizationId: string;
    readonly actorId: string | null;
    readonly actorEmail: string;
    readonly action: string;
    readonly resourceType: AuditLogResourceType;
    readonly resourceId: string | null;
    readonly metadata: string | null;
    readonly source: "session" | "api-key";
  }) => Effect.Effect<void>;

  readonly list: (params: {
    readonly organizationId: string;
    readonly action?: string | undefined;
    readonly resourceType?: string | undefined;
    readonly actorId?: string | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly page: number;
    readonly limit: number;
  }) => Effect.Effect<{ readonly items: readonly AuditLogModel[]; readonly total: number }>;
}

export class AuditLogRepo extends Context.Tag("api/AuditLogRepo")<
  AuditLogRepo,
  AuditLogRepository
>() {}

// -- D1 Adapter --------------------------------------------------------------

const SELECT_COLUMNS = `"id", "organization_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source", "created_at"`;

const toAuditLogModel = (row: AuditLogRow) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: row.metadata,
    source: row.source,
    createdAt: row.created_at,
  }) satisfies AuditLogModel;

export const AuditLogRepoLive = Layer.succeed(AuditLogRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "audit_logs" ("id", "organization_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.actorId,
            params.actorEmail,
            params.action,
            params.resourceType,
            params.resourceId,
            params.metadata,
            params.source,
          )
          .run(),
      );
    }),

  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;

      // SECURITY: All condition strings are hardcoded literals. Never interpolate user input into conditions.
      const conditions: string[] = ['"organization_id" = ?'];
      const bindValues: (string | number)[] = [params.organizationId];

      if (params.action) {
        conditions.push('"action" = ?');
        bindValues.push(params.action);
      }

      if (params.resourceType) {
        conditions.push('"resource_type" = ?');
        bindValues.push(params.resourceType);
      }

      if (params.actorId) {
        conditions.push('"actor_id" = ?');
        bindValues.push(params.actorId);
      }

      if (params.from) {
        conditions.push('"created_at" >= ?');
        bindValues.push(params.from);
      }

      if (params.to) {
        conditions.push('"created_at" <= ?');
        bindValues.push(params.to);
      }

      const whereClause = conditions.join(" AND ");
      const offset = (params.page - 1) * params.limit;

      const [countResult, rows] = yield* Effect.all(
        [
          Effect.promise(async () =>
            env.DB.prepare(`SELECT COUNT(*) as count FROM "audit_logs" WHERE ${whereClause}`)
              .bind(...bindValues)
              .first<{ count: number }>(),
          ),
          Effect.promise(async () =>
            env.DB.prepare(
              `SELECT ${SELECT_COLUMNS} FROM "audit_logs" WHERE ${whereClause} ORDER BY "created_at" DESC LIMIT ? OFFSET ?`,
            )
              .bind(...bindValues, params.limit, offset)
              .all<AuditLogRow>(),
          ),
        ],
        { concurrency: "unbounded" },
      );

      return { items: rows.results.map(toAuditLogModel), total: countResult?.count ?? 0 };
    }),
});
