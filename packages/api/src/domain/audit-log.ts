import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const AuditLogResourceType = Schema.Literal(
  "project",
  "branch",
  "channel",
  "update",
  "environment",
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
  "policy",
  "group",
  "policyAttachment",
  "robotAccount",
  "invitation",
  "member",
  "organization",
);

export type AuditLogResourceType = Schema.Schema.Type<typeof AuditLogResourceType>;

export const AuditLogSource = Schema.Literal("session", "robot");

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
