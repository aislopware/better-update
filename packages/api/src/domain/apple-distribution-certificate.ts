import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export class AppleDistributionCertificate extends Schema.Class<AppleDistributionCertificate>(
  "AppleDistributionCertificate",
)({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  serialNumber: Schema.String,
  developerIdIdentifier: Schema.NullOr(Schema.String),
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
export const UploadAppleDistributionCertificateBody = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  serialNumber: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
  developerIdIdentifier: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});

export const DeleteAppleDistributionCertificateResult = DeletedResult;

/** The encrypted envelope (relayed from R2) plus server-visible metadata; the CLI decrypts `ciphertext` to recover `{ p12Base64, p12Password }`. */
export const DownloadAppleDistributionCertificateResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  serialNumber: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});
