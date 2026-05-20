import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id } from "./common";

export class AndroidUploadKeystore extends Schema.Class<AndroidUploadKeystore>(
  "AndroidUploadKeystore",
)({
  id: Id,
  organizationId: Id,
  keyAlias: Schema.String,
  md5Fingerprint: Schema.NullOr(Schema.String),
  sha1Fingerprint: Schema.NullOr(Schema.String),
  sha256Fingerprint: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadAndroidUploadKeystoreBody = Schema.Struct({
  keystoreBase64: Schema.String.pipe(Schema.minLength(1)),
  keyAlias: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  keystorePassword: Schema.String.pipe(Schema.minLength(1)),
  keyPassword: Schema.String.pipe(Schema.minLength(1)),
  md5Fingerprint: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  sha1Fingerprint: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  sha256Fingerprint: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
});

export const DeleteAndroidUploadKeystoreResult = DeletedResult;

export const DownloadAndroidUploadKeystoreResult = Schema.Struct({
  id: Id,
  keystoreBase64: Schema.String,
  keyAlias: Schema.String,
  keystorePassword: Schema.String,
  keyPassword: Schema.String,
});
