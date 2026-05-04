import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { toApiAuditLog } from "../http/to-api";
import { toApiForbiddenEffect } from "../http/to-api-effect";
import { parseCursorPagination } from "../lib/cursor";
import { AuditLogRepo } from "../repositories/audit-logs";

export const AuditLogsGroupLive = HttpApiBuilder.group(ManagementApi, "audit-logs", (handlers) =>
  handlers.handle("list", ({ urlParams }) =>
    toApiForbiddenEffect(
      Effect.gen(function* () {
        yield* assertPermission("auditLog", "read");
        const ctx = yield* CurrentActor;
        const repo = yield* AuditLogRepo;

        const { cursor, limit } = parseCursorPagination(urlParams);

        const result = yield* repo.list({
          organizationId: ctx.organizationId,
          projectId: urlParams.projectId,
          resourceType: urlParams.resourceType,
          from: urlParams.from,
          to: urlParams.to,
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
