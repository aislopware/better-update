import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";

/**
 * Legacy APNs Push Services SSL certificate (the `.cer`/`.p12` push cert, distinct
 * from the modern `.p8` token key in `apple-push-key.ts`). Bound to a single App
 * ID (`bundleIdentifier`) rather than a whole team. The production cert serves
 * both the sandbox and production APNs environments.
 */
export class ApplePushCertificate extends Schema.Class<ApplePushCertificate>(
  "ApplePushCertificate",
)({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  bundleIdentifier: Schema.String,
  serialNumber: Schema.String,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

/**
 * Client-encrypted upload: the `.p12` bytes + password are sealed into
 * `ciphertext` (the CLI parses the cert locally to fill the metadata below);
 * the server stores the envelope and metadata and never sees the plaintext.
 */
export const UploadApplePushCertificateBody = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  bundleIdentifier: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  serialNumber: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});

export const DeleteApplePushCertificateResult = DeletedResult;

/** The encrypted envelope (relayed from R2) plus server-visible metadata; the CLI decrypts `ciphertext` to recover `{ p12Base64, p12Password }`. */
export const DownloadApplePushCertificateResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  bundleIdentifier: Schema.String,
  serialNumber: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});
