import { Schema } from "effect";

import { DateTimeString, Id } from "./common";

export const DistributionType = Schema.Literal("APP_STORE", "AD_HOC", "ENTERPRISE", "DEVELOPMENT");
export type DistributionTypeValue = typeof DistributionType.Type;

export const BundleIdentifier = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9.\-_]{1,200}$/u, {
    message: () => "Bundle identifier must be reverse-domain style (letters, digits, dot, dash)",
  }),
);

export class AppleProvisioningProfile extends Schema.Class<AppleProvisioningProfile>(
  "AppleProvisioningProfile",
)({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  appleDistributionCertificateId: Schema.NullOr(Id),
  bundleIdentifier: Schema.String,
  distributionType: DistributionType,
  developerPortalIdentifier: Schema.NullOr(Schema.String),
  profileName: Schema.NullOr(Schema.String),
  validUntil: Schema.NullOr(DateTimeString),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const UploadAppleProvisioningProfileBody = Schema.Struct({
  profileBase64: Schema.String.pipe(Schema.minLength(1)),
  appleDistributionCertificateId: Schema.optional(Id),
  deviceRosterHash: Schema.optional(Schema.String),
  isManaged: Schema.optional(Schema.Boolean),
});

export const DeleteAppleProvisioningProfileResult = Schema.Struct({ deleted: Schema.Number });

export const DownloadAppleProvisioningProfileResult = Schema.Struct({
  id: Id,
  profileBase64: Schema.String,
  bundleIdentifier: Schema.String,
  distributionType: DistributionType,
  profileName: Schema.NullOr(Schema.String),
  developerPortalIdentifier: Schema.NullOr(Schema.String),
});

export const ListAppleProvisioningProfilesParams = Schema.Struct({
  bundleIdentifier: Schema.optional(BundleIdentifier),
  distributionType: Schema.optional(DistributionType),
  appleTeamId: Schema.optional(Id),
});
