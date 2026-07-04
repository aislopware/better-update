import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";
import { credentialCreateBindingField } from "./credential-binding";
import { encryptedEnvelopeFields } from "./encrypted-credential";

/**
 * Apple Pay Payment Processing certificate, bound to a Merchant ID
 * (`merchant.*`). The library cannot create these (no portal cert type), so they
 * are uploaded manually: the CLI seals the `.p12` (cert + key) and the server
 * stores only the envelope + metadata.
 */
export class ApplePayCertificate extends Schema.Class<ApplePayCertificate>("ApplePayCertificate")({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  merchantIdentifier: Schema.String,
  serialNumber: Schema.String,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

/** Client-encrypted upload: the `.p12` bytes + password are sealed into `ciphertext`. */
export const UploadApplePayCertificateBody = Schema.Struct({
  ...credentialCreateBindingField,
  id: Id,
  ...encryptedEnvelopeFields,
  merchantIdentifier: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  serialNumber: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});

export const DeleteApplePayCertificateResult = DeletedResult;

/** The encrypted envelope (relayed from R2) plus metadata; the CLI decrypts `ciphertext` to recover `{ p12Base64, p12Password }`. */
export const DownloadApplePayCertificateResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  merchantIdentifier: Schema.String,
  serialNumber: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});
