import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ManagementApi } from "../api";
import { CurrentActor } from "../auth/current-actor";
import { assertPermission } from "../auth/permissions";
import { toApiAuditLog } from "../http/to-api";
import { toApiForbiddenEffect } from "../http/to-api-effect";
import { AuditLogRepo } from "../repositories/audit-logs";

export const AuditLogsGroupLive = HttpApiBuilder.group(ManagementApi, "audit-logs", (handlers) =>
  handlers.handle("list", ({ urlParams }) =>
    toApiForbiddenEffect(
      Effect.gen(function* () {
        yield* assertPermission("auditLog", "read");
        const ctx = yield* CurrentActor;
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
          items: result.items.map(toApiAuditLog),
          total: result.total,
          page,
          limit,
        };
      }),
    ),
  ),
);
