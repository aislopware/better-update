import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";

/**
 * Pass Type ID certificate (Wallet passes), bound to a Pass Type ID
 * (`pass.*`). The library has no Pass Type ID API, so these are uploaded
 * manually: the CLI seals the `.p12` (cert + key) and the server stores only the
 * envelope + metadata.
 */
export class ApplePassTypeCertificate extends Schema.Class<ApplePassTypeCertificate>(
  "ApplePassTypeCertificate",
)({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  passTypeIdentifier: Schema.String,
  serialNumber: Schema.String,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

/** Client-encrypted upload: the `.p12` bytes + password are sealed into `ciphertext`. */
export const UploadApplePassTypeCertificateBody = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  passTypeIdentifier: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  serialNumber: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});

export const DeleteApplePassTypeCertificateResult = DeletedResult;

/** The encrypted envelope (relayed from R2) plus metadata; the CLI decrypts `ciphertext` to recover `{ p12Base64, p12Password }`. */
export const DownloadApplePassTypeCertificateResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  passTypeIdentifier: Schema.String,
  serialNumber: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});
