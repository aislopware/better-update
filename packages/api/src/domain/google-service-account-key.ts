import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id } from "./common";

export class GoogleServiceAccountKey extends Schema.Class<GoogleServiceAccountKey>(
  "GoogleServiceAccountKey",
)({
  id: Id,
  organizationId: Id,
  clientEmail: Schema.String,
  privateKeyId: Schema.String,
  googleProjectId: Schema.String,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadGoogleServiceAccountKeyBody = Schema.Struct({
  json: Schema.String.pipe(Schema.minLength(1)),
});

export const DeleteGoogleServiceAccountKeyResult = DeletedResult;

export const DownloadGoogleServiceAccountKeyResult = Schema.Struct({
  id: Id,
  json: Schema.String,
  clientEmail: Schema.String,
});
