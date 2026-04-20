import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

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

export const DeleteGoogleServiceAccountKeyResult = Schema.Struct({ deleted: Schema.Number });
