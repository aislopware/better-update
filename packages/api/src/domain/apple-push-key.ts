import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields, tenCharPortalId } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export const ApplePushKeyId = tenCharPortalId("Push Key ID");

export class ApplePushKey extends Schema.Class<ApplePushKey>("ApplePushKey")({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  keyId: Schema.String,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

/** Client-encrypted upload: the `.p8` PEM is sealed into `ciphertext`. */
export const UploadApplePushKeyBody = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  keyId: ApplePushKeyId,
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
});

export const DeleteApplePushKeyResult = DeletedResult;

/** Encrypted envelope plus metadata; the CLI decrypts `ciphertext` to recover `{ p8Pem }`. */
export const DownloadApplePushKeyResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  keyId: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
});
