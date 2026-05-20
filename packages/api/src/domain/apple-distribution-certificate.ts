import { Schema } from "effect";

import { AppleTeamIdentifier, appleTeamMetadataFields } from "./apple-team";
import { DateTimeString, DeletedResult, Id } from "./common";

export class AppleDistributionCertificate extends Schema.Class<AppleDistributionCertificate>(
  "AppleDistributionCertificate",
)({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  serialNumber: Schema.String,
  developerIdIdentifier: Schema.NullOr(Schema.String),
  validFrom: DateTimeString,
  validUntil: DateTimeString,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadAppleDistributionCertificateBody = Schema.Struct({
  p12Base64: Schema.String.pipe(Schema.minLength(1)),
  p12Password: Schema.String.pipe(Schema.minLength(1)),
  serialNumber: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  appleTeamIdentifier: AppleTeamIdentifier,
  ...appleTeamMetadataFields,
  developerIdIdentifier: Schema.optional(Schema.String.pipe(Schema.maxLength(200))),
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});

export const DeleteAppleDistributionCertificateResult = DeletedResult;

export const DownloadAppleDistributionCertificateResult = Schema.Struct({
  id: Id,
  p12Base64: Schema.String,
  p12Password: Schema.String,
  serialNumber: Schema.String,
  appleTeamIdentifier: AppleTeamIdentifier,
  validFrom: DateTimeString,
  validUntil: DateTimeString,
});
