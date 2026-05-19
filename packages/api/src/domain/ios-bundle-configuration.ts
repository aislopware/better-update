import { Schema } from "effect";

import { BundleIdentifier, DistributionType } from "./apple-provisioning-profile";
import { DateTimeString, Id } from "./common";

const TargetName = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));

export class IosBundleConfiguration extends Schema.Class<IosBundleConfiguration>(
  "IosBundleConfiguration",
)({
  id: Id,
  organizationId: Id,
  projectId: Id,
  bundleIdentifier: Schema.String,
  distributionType: DistributionType,
  appleTeamId: Id,
  appleDistributionCertificateId: Schema.NullOr(Id),
  appleProvisioningProfileId: Schema.NullOr(Id),
  applePushKeyId: Schema.NullOr(Id),
  ascApiKeyId: Schema.NullOr(Id),
  targetName: Schema.NullOr(Schema.String),
  parentBundleIdentifier: Schema.NullOr(Schema.String),
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}) {}

export const CreateIosBundleConfigurationBody = Schema.Struct({
  bundleIdentifier: BundleIdentifier,
  distributionType: DistributionType,
  appleTeamId: Id,
  appleDistributionCertificateId: Schema.optional(Id),
  appleProvisioningProfileId: Schema.optional(Id),
  applePushKeyId: Schema.optional(Id),
  ascApiKeyId: Schema.optional(Id),
  targetName: Schema.optional(TargetName),
  parentBundleIdentifier: Schema.optional(BundleIdentifier),
});

export const UpdateIosBundleConfigurationBody = Schema.Struct({
  appleDistributionCertificateId: Schema.optional(Schema.NullOr(Id)),
  appleProvisioningProfileId: Schema.optional(Schema.NullOr(Id)),
  applePushKeyId: Schema.optional(Schema.NullOr(Id)),
  ascApiKeyId: Schema.optional(Schema.NullOr(Id)),
  targetName: Schema.optional(Schema.NullOr(TargetName)),
  parentBundleIdentifier: Schema.optional(Schema.NullOr(BundleIdentifier)),
});

export const DeleteIosBundleConfigurationResult = Schema.Struct({ deleted: Schema.Number });
