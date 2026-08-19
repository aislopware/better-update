import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields, tenCharPortalId } from "./apple-team";
import { DateTimeString, DeletedResult, Id, Name120 } from "./common";
import { boundProjectIdsField, credentialCreateBindingField } from "./credential-binding";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export const AscApiKeyId = tenCharPortalId("ASC API Key ID");

export const IssuerId = Schema.String.check(
  Schema.isPattern(
    /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/u,
    {
      message: "Issuer ID must be a UUID (8-4-4-4-12 hex)",
    },
  ),
);

export const AscApiKey = Schema.Struct({
  ...boundProjectIdsField,
  id: Id,
  organizationId: Id,
  appleTeamId: Schema.NullOr(Id),
  keyId: Schema.String,
  issuerId: IssuerId,
  name: Schema.String,
  roles: Schema.Array(Schema.String),
  /**
   * Per-row protected flag (GITLAB-RBAC-SPEC §3b): reads/uses require
   * Maintainer+ when set. Team-less keys are created protected.
   */
  protected: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}).annotate({ identifier: "AscApiKey" });
export type AscApiKey = typeof AscApiKey.Type;

/** Client-encrypted upload: the `.p8` PEM is sealed into `ciphertext`. */
export const UploadAscApiKeyBody = Schema.Struct({
  ...credentialCreateBindingField,
  id: Id,
  ...encryptedEnvelopeFields,
  name: Name120,
  keyId: AscApiKeyId,
  issuerId: IssuerId,
  appleTeamIdentifier: Schema.optional(AppleTeamIdentifier),
  ...appleTeamMetadataFields,
  roles: Schema.optional(Schema.Array(Schema.String)),
});

export const DeleteAscApiKeyResult = DeletedResult;

/** Encrypted envelope plus metadata; the CLI decrypts `ciphertext` to recover `{ p8Pem }`. */
export const DownloadAscApiKeyResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  name: Schema.String,
  keyId: AscApiKeyId,
  issuerId: IssuerId,
  appleTeamIdentifier: Schema.NullOr(AppleTeamIdentifier),
});

/**
 * Returned by `getCredentials` for direct App Store Connect API calls from the
 * CLI: the encrypted `.p8` envelope plus the public key metadata. The CLI
 * decrypts `ciphertext` locally to recover the `.p8` PEM — the server never
 * holds it in plaintext.
 */
export const AscApiKeyCredentials = Schema.Struct({
  ascApiKeyId: Id,
  ...encryptedEnvelopeFields,
  keyId: AscApiKeyId,
  issuerId: IssuerId,
  appleTeamIdentifier: Schema.NullOr(AppleTeamIdentifier),
}).annotate({ identifier: "AscApiKeyCredentials" });
export type AscApiKeyCredentials = typeof AscApiKeyCredentials.Type;
