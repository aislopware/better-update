import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { AuditLog, AuditLogResourceType } from "../domain/audit-log";
import { CursorPaginationParams, cursorPageResult } from "../domain/common";

export class AuditLogsGroup extends HttpApiGroup.make("audit-logs")
  .add(
    HttpApiEndpoint.get("list", "/api/audit-logs")
      .setUrlParams(
        Schema.Struct({
          projectId: Schema.optional(Schema.String),
          resourceType: Schema.optional(AuditLogResourceType),
          from: Schema.optional(Schema.String),
          to: Schema.optional(Schema.String),
          ...CursorPaginationParams.fields,
        }),
      )
      .addSuccess(cursorPageResult(AuditLog))
      .annotateContext(
        OpenApi.annotations({
          title: "List audit logs",
          description: "List audit log entries with optional filters",
        }),
      ),
  )
  .addError(Forbidden)
  .annotateContext(
    OpenApi.annotations({
      title: "Audit Logs",
      description: "View audit trail for organization actions",
    }),
  ) {}
