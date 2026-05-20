import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields, tenCharPortalId } from "./apple-team";
import { DateTimeString, DeletedResult, Id, Name120 } from "./common";

export const AscApiKeyId = tenCharPortalId("ASC API Key ID");

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
  issuerId: IssuerId,
  name: Schema.String,
  roles: Schema.Array(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadAscApiKeyBody = Schema.Struct({
  name: Name120,
  keyId: AscApiKeyId,
  issuerId: IssuerId,
  p8Pem: Schema.String.pipe(Schema.minLength(1)),
  appleTeamIdentifier: Schema.optional(AppleTeamIdentifier),
  ...appleTeamMetadataFields,
  roles: Schema.optional(Schema.Array(Schema.String)),
});

export const DeleteAscApiKeyResult = DeletedResult;

export const DownloadAscApiKeyResult = Schema.Struct({
  id: Id,
  name: Schema.String,
  keyId: AscApiKeyId,
  issuerId: IssuerId,
  p8Pem: Schema.String,
  appleTeamIdentifier: Schema.NullOr(AppleTeamIdentifier),
});

export class AscApiKeyCredentials extends Schema.Class<AscApiKeyCredentials>(
  "AscApiKeyCredentials",
)({
  ascApiKeyId: Id,
  keyId: AscApiKeyId,
  issuerId: IssuerId,
  p8Pem: Schema.String,
  appleTeamIdentifier: Schema.NullOr(AppleTeamIdentifier),
}) {}

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
