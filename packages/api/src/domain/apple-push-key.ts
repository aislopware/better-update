import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields, tenCharPortalId } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";

export const ApplePushKeyId = tenCharPortalId("Push Key ID");

export class ApplePushKey extends Schema.Class<ApplePushKey>("ApplePushKey")({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  keyId: Schema.String,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadApplePushKeyBody = Schema.Struct({
  keyId: ApplePushKeyId,
  p8Pem: Schema.String.pipe(Schema.minLength(1)),
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
});

export const DeleteApplePushKeyResult = DeletedResult;

export const DownloadApplePushKeyResult = Schema.Struct({
  id: Id,
  p8Pem: Schema.String,
  keyId: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
});
