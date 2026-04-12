import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { Forbidden } from "../auth/errors";
import { AuditLog } from "../domain/audit-log";
import { PaginationParams } from "../domain/common";

export class AuditLogsGroup extends HttpApiGroup.make("audit-logs")
  .add(
    HttpApiEndpoint.get("list", "/api/audit-logs")
      .setUrlParams(
        Schema.Struct({
          action: Schema.optional(Schema.String),
          resourceType: Schema.optional(Schema.String),
          actorId: Schema.optional(Schema.String),
          from: Schema.optional(Schema.String),
          to: Schema.optional(Schema.String),
          ...PaginationParams.fields,
        }),
      )
      .addSuccess(
        Schema.Struct({
          items: Schema.Array(AuditLog),
          total: Schema.Number,
          page: Schema.Number,
          limit: Schema.Number,
        }),
      )
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
