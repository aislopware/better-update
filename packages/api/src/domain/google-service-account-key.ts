import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id } from "./common";
import { boundProjectIdsField, credentialCreateBindingField } from "./credential-binding";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export const GoogleServiceAccountKey = Schema.Struct({
  ...boundProjectIdsField,
  id: Id,
  organizationId: Id,
  clientEmail: Schema.String,
  privateKeyId: Schema.String,
  googleProjectId: Schema.String,
  clientId: Schema.NullOr(Schema.String),
  /** Protected-credential flag (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+ when set. */
  protected: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}).annotate({ identifier: "GoogleServiceAccountKey" });
export type GoogleServiceAccountKey = typeof GoogleServiceAccountKey.Type;

/**
 * Client-encrypted upload: the service-account JSON is sealed into `ciphertext`.
 * The CLI parses the JSON locally to fill the metadata below — the server can
 * no longer read the blob, so the identifying fields travel as plaintext.
 */
export const UploadGoogleServiceAccountKeyBody = Schema.Struct({
  ...credentialCreateBindingField,
  id: Id,
  ...encryptedEnvelopeFields,
  clientEmail: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(320)),
  privateKeyId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  googleProjectId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  clientId: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(200)))),
});

export const DeleteGoogleServiceAccountKeyResult = DeletedResult;

/** Encrypted envelope plus metadata; the CLI decrypts `ciphertext` to recover `{ json }`. */
export const DownloadGoogleServiceAccountKeyResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  clientEmail: Schema.String,
});
