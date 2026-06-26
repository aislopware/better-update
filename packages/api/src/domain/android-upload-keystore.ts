import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export class AndroidUploadKeystore extends Schema.Class<AndroidUploadKeystore>(
  "AndroidUploadKeystore",
)({
  id: Id,
  organizationId: Id,
  /** User-supplied label from `credentials upload --name`; null for keystores uploaded before names were stored or generated via keytool. */
  name: Schema.NullOr(Schema.String),
  keyAlias: Schema.String,
  md5Fingerprint: Schema.NullOr(Schema.String),
  sha1Fingerprint: Schema.NullOr(Schema.String),
  sha256Fingerprint: Schema.NullOr(Schema.String),
  keystoreType: Schema.NullOr(Schema.Literal("JKS", "PKCS12")),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

/**
 * Client-encrypted upload: the keystore bytes + store/key passwords are sealed
 * into `ciphertext`. The CLI reads the keystore locally to fill the alias and
 * fingerprints below — the server stores only metadata + the envelope.
 */
export const UploadAndroidUploadKeystoreBody = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  name: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  keyAlias: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  md5Fingerprint: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  sha1Fingerprint: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  sha256Fingerprint: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  keystoreType: Schema.optional(Schema.Literal("JKS", "PKCS12")),
});

export const DeleteAndroidUploadKeystoreResult = DeletedResult;

/** Encrypted envelope plus metadata; the CLI decrypts `ciphertext` to recover `{ keystoreBase64, keystorePassword, keyPassword }`. */
export const DownloadAndroidUploadKeystoreResult = Schema.Struct({
  id: Id,
  ...encryptedEnvelopeFields,
  keyAlias: Schema.String,
});
