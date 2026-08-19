import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { toApiAuditLog } from "../http/to-api";
import { toApiForbiddenEffect } from "../http/to-api-effect";
import { parseCursorPagination } from "../lib/cursor";
import { AuditLogRepo } from "../repositories/audit-logs";

export const AuditLogsGroupLive = HttpApiBuilder.group(ManagementApi, "audit-logs", (handlers) =>
  handlers.handle("list", ({ query }) =>
    toApiForbiddenEffect(
      Effect.gen(function* () {
        yield* assertPermission("auditLog", "read");
        const ctx = yield* CurrentActor;
        const repo = yield* AuditLogRepo;

        const { cursor, limit } = parseCursorPagination(query);

        const result = yield* repo.list({
          organizationId: ctx.organizationId,
          projectId: query.projectId,
          resourceTypes: query.resourceType,
          from: query.from,
          to: query.to,
          cursor,
          limit,
        });

        return {
          items: result.items.map(toApiAuditLog),
          nextCursor: result.nextCursor,
        };
      }),
    ),
  ),
);
