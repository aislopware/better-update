import { Context, Effect, Layer } from "effect";

import type { Selectable } from "kysely";

import { kyselyDb } from "../cloudflare/db";
import { encodeCursor } from "../lib/cursor";

import type { AuditLogs } from "../db/schema";
import type { Cursor } from "../lib/cursor";
import type { AuditLogModel, AuditLogResourceType } from "../models";

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
    readonly resourceType?: AuditLogResourceType | undefined;
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

const COLUMNS = [
  "id",
  "organization_id",
  "project_id",
  "actor_id",
  "actor_email",
  "action",
  "resource_type",
  "resource_id",
  "metadata",
  "source",
  "created_at",
] as const;

const toAuditLogModel = (row: Selectable<AuditLogs>): AuditLogModel => ({
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
});

export const AuditLogRepoLive = Layer.succeed(AuditLogRepo, {
  insert: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      yield* Effect.promise(async () =>
        db
          .insertInto("audit_logs")
          .values({
            id: params.id,
            organization_id: params.organizationId,
            project_id: params.projectId,
            actor_id: params.actorId,
            actor_email: params.actorEmail,
            action: params.action,
            resource_type: params.resourceType,
            resource_id: params.resourceId,
            metadata: params.metadata,
            source: params.source,
          })
          .execute(),
      );
    }),

  list: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;

      const { projectId, resourceType, from, to, cursor } = params;

      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("audit_logs")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .$if(Boolean(projectId), (qb) => {
            if (projectId === undefined) {
              return qb;
            }
            return qb.where("project_id", "=", projectId);
          })
          .$if(Boolean(resourceType), (qb) => {
            if (resourceType === undefined) {
              return qb;
            }
            return qb.where("resource_type", "=", resourceType);
          })
          .$if(Boolean(from), (qb) => {
            if (from === undefined) {
              return qb;
            }
            return qb.where("created_at", ">=", from);
          })
          .$if(Boolean(to), (qb) => {
            if (to === undefined) {
              return qb;
            }
            return qb.where("created_at", "<=", to);
          })
          .$if(cursor !== null, (qb) => {
            if (cursor === null) {
              return qb;
            }
            return qb.where((eb) =>
              eb.or([
                eb("created_at", "<", cursor.createdAt),
                eb.and([eb("created_at", "=", cursor.createdAt), eb("id", "<", cursor.id)]),
              ]),
            );
          })
          .orderBy("created_at", "desc")
          .orderBy("id", "desc")
          .limit(params.limit + 1)
          .execute(),
      );

      const hasMore = rows.length > params.limit;
      const trimmed = hasMore ? rows.slice(0, params.limit) : rows;
      const items = trimmed.map(toAuditLogModel);
      const last = items.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

      return { items, nextCursor };
    }),
});
