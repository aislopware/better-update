import { Schema } from "effect";

import { AppleCertificateType } from "./apple-certificate-type";
import { AppleTeamIdentifier, appleTeamMetadataFields } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";
import { credentialCreateBindingField } from "./credential-binding";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export class AppleDistributionCertificate extends Schema.Class<AppleDistributionCertificate>(
  "AppleDistributionCertificate",
)({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  serialNumber: Schema.String,
  /** Which kind of Apple signing certificate this is — iOS, Mac App Store or Developer ID. */
  certificateType: AppleCertificateType,
  developerIdIdentifier: Schema.NullOr(Schema.String),
  validFrom: DateTimeString,
  validUntil: DateTimeString,
  /** Per-row protected flag (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+ when set. */
  protected: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

/**
 * Client-encrypted upload: the `.p12` bytes + password are sealed into
 * `ciphertext` (the CLI parses the cert locally to fill the metadata below);
 * the server stores the envelope and metadata and never sees the plaintext.
 */
export const UploadAppleDistributionCertificateBody = Schema.Struct({
  ...credentialCreateBindingField,
  id: Id,
  ...encryptedEnvelopeFields,
  serialNumber: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
  /**
   * Optional so a CLI predating the field still uploads: the server then falls
   * back to the old heuristic (a `developerIdIdentifier` means Developer ID
   * Application, anything else iOS distribution).
   */
  certificateType: Schema.optional(AppleCertificateType),
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
  certificateType: AppleCertificateType,
  appleTeamIdentifier: AppleTeamIdentifier,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});
