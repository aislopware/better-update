import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const AuditLogResourceType = Schema.Literal(
  "project",
  "branch",
  "channel",
  "update",
  "build",
  "appleCredential",
  "androidCredential",
  "iosBundleConfiguration",
  "envVar",
  "device",
  "webhook",
  "iosAppMetadata",
  "submission",
  "vaultAccess",
);

export const AuditLogSource = Schema.Literal("session", "api-key");

export class AuditLog extends Schema.Class<AuditLog>("AuditLog")({
  id: Id,
  organizationId: Id,
  actorId: Schema.NullOr(Schema.String),
  actorEmail: Schema.String,
  action: Schema.String,
  resourceType: AuditLogResourceType,
  resourceId: Schema.NullOr(Schema.String),
  metadata: Schema.NullOr(Schema.String),
  source: AuditLogSource,
  createdAt: DateTimeString,
}) {}
