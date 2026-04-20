import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export class AndroidBuildCredentials extends Schema.Class<AndroidBuildCredentials>(
  "AndroidBuildCredentials",
)({
  id: Id,
  organizationId: Id,
  androidApplicationIdentifierId: Id,
  androidUploadKeystoreId: Schema.NullOr(Id),
  googleServiceAccountKeyForSubmissionsId: Schema.NullOr(Id),
  googleServiceAccountKeyForFcmV1Id: Schema.NullOr(Id),
  name: Schema.String,
  isDefault: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const CreateAndroidBuildCredentialsBody = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120)),
  androidUploadKeystoreId: Schema.optional(Id),
  googleServiceAccountKeyForSubmissionsId: Schema.optional(Id),
  googleServiceAccountKeyForFcmV1Id: Schema.optional(Id),
  isDefault: Schema.optional(Schema.Boolean),
});

export const UpdateAndroidBuildCredentialsBody = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
  androidUploadKeystoreId: Schema.optional(Schema.NullOr(Id)),
  googleServiceAccountKeyForSubmissionsId: Schema.optional(Schema.NullOr(Id)),
  googleServiceAccountKeyForFcmV1Id: Schema.optional(Schema.NullOr(Id)),
  isDefault: Schema.optional(Schema.Boolean),
});

export const DeleteAndroidBuildCredentialsResult = Schema.Struct({ deleted: Schema.Number });
