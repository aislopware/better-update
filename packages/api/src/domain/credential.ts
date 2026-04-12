import { Schema } from "effect";

import { DateTimeString, Id, Platform } from "./common";

export const CredentialType = Schema.Literal(
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "keystore",
  "play-service-account",
);

export const CredentialDistribution = Schema.Literal(
  "ad-hoc",
  "app-store",
  "development",
  "enterprise",
  "play-store",
  "direct",
);

export class Credential extends Schema.Class<Credential>("Credential")({
  id: Id,
  organizationId: Id,
  projectId: Schema.NullOr(Id),
  platform: Platform,
  type: CredentialType,
  name: Schema.String,
  distribution: Schema.NullOr(CredentialDistribution),
  isActive: Schema.Boolean,
  metadata: Schema.String,
  expiresAt: Schema.NullOr(DateTimeString),
  createdAt: DateTimeString,
}) {}

const MAX_BLOB_BASE64_LENGTH = 700_000;

export const CreateCredentialBody = Schema.Struct({
  platform: Platform,
  type: CredentialType,
  name: Schema.String,
  blob: Schema.String.pipe(Schema.maxLength(MAX_BLOB_BASE64_LENGTH)),
  projectId: Schema.optional(Id),
  distribution: Schema.optional(CredentialDistribution),
  password: Schema.optional(Schema.String),
  keyAlias: Schema.optional(Schema.String),
  keyPassword: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.String),
});

export const CredentialDownload = Schema.Struct({
  blob: Schema.String,
  password: Schema.NullOr(Schema.String),
  keyAlias: Schema.NullOr(Schema.String),
  keyPassword: Schema.NullOr(Schema.String),
  filename: Schema.String,
  contentType: Schema.String,
});

export const DeleteCredentialResult = Schema.Struct({
  id: Id,
});
