import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const AuditLogResourceType = Schema.Literals([
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
  "credentialBinding",
  "invitation",
  "member",
  "organization",
]);

export type AuditLogResourceType = typeof AuditLogResourceType.Type;

export const AuditLogSource = Schema.Literals(["session", "robot"]);

export const AuditLog = Schema.Struct({
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
}).annotate({ identifier: "AuditLog" });
export type AuditLog = typeof AuditLog.Type;
