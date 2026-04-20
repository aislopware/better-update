import { Schema } from "effect";

import { AppleTeamIdentifier } from "./apple-team";
import { DateTimeString, Id } from "./common";

export const AscApiKeyId = Schema.String.pipe(
  Schema.pattern(/^[A-Z0-9]{10}$/u, {
    message: () => "ASC API Key ID must be 10 uppercase alphanumeric characters",
  }),
);

export const IssuerId = Schema.String.pipe(
  Schema.pattern(/^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/u, {
    message: () => "Issuer ID must be a UUID (8-4-4-4-12 hex)",
  }),
);

export class AscApiKey extends Schema.Class<AscApiKey>("AscApiKey")({
  id: Id,
  organizationId: Id,
  appleTeamId: Schema.NullOr(Id),
  keyId: Schema.String,
  name: Schema.String,
  roles: Schema.Array(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadAscApiKeyBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  keyId: AscApiKeyId,
  issuerId: IssuerId,
  p8Pem: Schema.String.pipe(Schema.minLength(1)),
  appleTeamIdentifier: Schema.optional(AppleTeamIdentifier),
  appleTeamName: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  appleTeamType: Schema.optional(Schema.Literal("IN_HOUSE", "COMPANY_ORGANIZATION", "INDIVIDUAL")),
  roles: Schema.optional(Schema.Array(Schema.String)),
});

export const DeleteAscApiKeyResult = Schema.Struct({ deleted: Schema.Number });

export const SyncedDeviceSummary = Schema.Struct({
  id: Id,
  identifier: Schema.String,
  name: Schema.String,
  deviceClass: Schema.Literal("IPHONE", "IPAD", "MAC", "UNKNOWN"),
});

export const SyncDevicesResult = Schema.Struct({
  pulled: Schema.Number,
  pushed: Schema.Number,
  skipped: Schema.Number,
  devices: Schema.Array(SyncedDeviceSummary),
});
