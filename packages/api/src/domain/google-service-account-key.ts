import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export class GoogleServiceAccountKey extends Schema.Class<GoogleServiceAccountKey>(
  "GoogleServiceAccountKey",
)({
  id: Id,
  organizationId: Id,
  clientEmail: Schema.String,
  privateKeyId: Schema.String,
  googleProjectId: Schema.String,
  clientId: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

/**
 * Client-encrypted upload: the service-account JSON is sealed into `ciphertext`.
 * The CLI parses the JSON locally to fill the metadata below — the server can
 * no longer read the blob, so the identifying fields travel as plaintext.
 */
export const UploadGoogleServiceAccountKeyBody = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  clientEmail: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(320)),
  privateKeyId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  googleProjectId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  clientId: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.maxLength(200)))),
});

export const DeleteGoogleServiceAccountKeyResult = DeletedResult;

/** Encrypted envelope plus metadata; the CLI decrypts `ciphertext` to recover `{ json }`. */
export const DownloadGoogleServiceAccountKeyResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  clientEmail: Schema.String,
});
