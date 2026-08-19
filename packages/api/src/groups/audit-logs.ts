import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";

import { Forbidden } from "../auth/errors";
import { AuditLog, AuditLogResourceType } from "../domain/audit-log";
import { csvList, CursorPaginationParams, cursorPageResult } from "../domain/common";

export const AuditLogsGroup = HttpApiGroup.make("audit-logs")
  .add(
    HttpApiEndpoint.get("list", "/api/audit-logs", {
      query: Schema.Struct({
        projectId: Schema.optional(Schema.String),
        resourceType: Schema.optional(csvList(AuditLogResourceType)),
        from: Schema.optional(Schema.String),
        to: Schema.optional(Schema.String),
        ...CursorPaginationParams.fields,
      }),
      success: cursorPageResult(AuditLog),
      error: [Forbidden],
    }).annotateMerge(
      OpenApi.annotations({
        title: "List audit logs",
        description: "List audit log entries with optional filters",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Audit Logs",
      description: "View audit trail for organization actions",
    }),
  );
