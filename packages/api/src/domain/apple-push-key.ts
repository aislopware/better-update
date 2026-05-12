import { Schema } from "effect";

import { AppleTeamIdentifier } from "./apple-team";
import { DateTimeString, Id } from "./common";

export const ApplePushKeyId = Schema.String.pipe(
  Schema.pattern(/^[A-Z0-9]{10}$/u, {
    message: () => "Push Key ID must be 10 uppercase alphanumeric characters",
  }),
);

export class ApplePushKey extends Schema.Class<ApplePushKey>("ApplePushKey")({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  keyId: Schema.String,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadApplePushKeyBody = Schema.Struct({
  keyId: ApplePushKeyId,
  p8Pem: Schema.String.pipe(Schema.minLength(1)),
  appleTeamIdentifier: AppleTeamIdentifier,
  appleTeamName: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  appleTeamType: Schema.optional(Schema.Literal("IN_HOUSE", "COMPANY_ORGANIZATION", "INDIVIDUAL")),
});

export const DeleteApplePushKeyResult = Schema.Struct({ deleted: Schema.Number });

export const DownloadApplePushKeyResult = Schema.Struct({
  id: Id,
  p8Pem: Schema.String,
  keyId: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
});
