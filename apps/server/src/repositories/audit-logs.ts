import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { encodeCursor } from "../lib/cursor";

import type { Cursor } from "../lib/cursor";
import type { AuditLogModel, AuditLogResourceType } from "../models";

// -- Row type ----------------------------------------------------------------

export interface AuditLogRow {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string | null;
  readonly actor_id: string | null;
  readonly actor_email: string;
  readonly action: string;
  readonly resource_type: AuditLogResourceType;
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
    readonly projectId: string | null;
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
    readonly projectId?: string | undefined;
    readonly resourceType?: string | undefined;
    readonly from?: string | undefined;
    readonly to?: string | undefined;
    readonly cursor: Cursor | null;
    readonly limit: number;
  }) => Effect.Effect<{
    readonly items: readonly AuditLogModel[];
    readonly nextCursor: string | null;
  }>;
}

export class AuditLogRepo extends Context.Tag("api/AuditLogRepo")<
  AuditLogRepo,
  AuditLogRepository
>() {}

// -- D1 Adapter --------------------------------------------------------------

const SELECT_COLUMNS = `"id", "organization_id", "project_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source", "created_at"`;

const toAuditLogModel = (row: AuditLogRow) =>
  ({
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
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
          `INSERT INTO "audit_logs" ("id", "organization_id", "project_id", "actor_id", "actor_email", "action", "resource_type", "resource_id", "metadata", "source") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            params.id,
            params.organizationId,
            params.projectId,
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

      if (params.projectId) {
        conditions.push('"project_id" = ?');
        bindValues.push(params.projectId);
      }

      if (params.resourceType) {
        conditions.push('"resource_type" = ?');
        bindValues.push(params.resourceType);
      }

      if (params.from) {
        conditions.push('"created_at" >= ?');
        bindValues.push(params.from);
      }

      if (params.to) {
        conditions.push('"created_at" <= ?');
        bindValues.push(params.to);
      }

      if (params.cursor) {
        conditions.push('("created_at" < ? OR ("created_at" = ? AND "id" < ?))');
        bindValues.push(params.cursor.createdAt, params.cursor.createdAt, params.cursor.id);
      }

      const whereClause = conditions.join(" AND ");

      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${SELECT_COLUMNS} FROM "audit_logs" WHERE ${whereClause} ORDER BY "created_at" DESC, "id" DESC LIMIT ?`,
        )
          .bind(...bindValues, params.limit + 1)
          .all<AuditLogRow>(),
      );

      const hasMore = rows.results.length > params.limit;
      const trimmed = hasMore ? rows.results.slice(0, params.limit) : rows.results;
      const last = trimmed.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

      return { items: trimmed.map(toAuditLogModel), nextCursor };
    }),
});
