import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields, tenCharPortalId } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";
import { credentialCreateBindingField } from "./credential-binding";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export const ApplePushKeyId = tenCharPortalId("Push Key ID");

export const ApplePushKey = Schema.Struct({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  keyId: Schema.String,
  /** Per-row protected flag (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+ when set. */
  protected: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}).annotate({ identifier: "ApplePushKey" });
export type ApplePushKey = typeof ApplePushKey.Type;

/** Client-encrypted upload: the `.p8` PEM is sealed into `ciphertext`. */
export const UploadApplePushKeyBody = Schema.Struct({
  ...credentialCreateBindingField,
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
