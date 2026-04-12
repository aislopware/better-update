import { AuditLog, AuthContext } from "@better-update/api";
import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { assertPermission } from "../auth/permissions";
import { AuditLogRepo } from "../repositories/audit-logs";

import type { AuditLogRow } from "../repositories/audit-logs";

const rowToAuditLog = (row: AuditLogRow) =>
  new AuditLog({
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
  });

export const AuditLogsGroupLive = HttpApiBuilder.group(ManagementApi, "audit-logs", (handlers) =>
  handlers.handle("list", ({ urlParams }) =>
    Effect.gen(function* () {
      yield* assertPermission("auditLog", "read");
      const ctx = yield* AuthContext;
      const repo = yield* AuditLogRepo;

      const page = urlParams.page ?? 1;
      const limit = Math.min(urlParams.limit ?? 50, 100);

      const result = yield* repo.list({
        organizationId: ctx.organizationId,
        action: urlParams.action,
        resourceType: urlParams.resourceType,
        actorId: urlParams.actorId,
        from: urlParams.from,
        to: urlParams.to,
        page,
        limit,
      });

      return {
        items: result.items.map(rowToAuditLog),
        total: result.total,
        page,
        limit,
      };
    }),
  ),
);
