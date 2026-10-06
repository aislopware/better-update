import { Schema } from "effect";

import { DateTimeString, DeletedResult, Id } from "./common";
import { credentialCreateBindingField } from "./credential-binding";

export const DistributionType = Schema.Literals([
  "APP_STORE",
  "AD_HOC",
  "ENTERPRISE",
  "DEVELOPMENT",
]);
export type DistributionTypeValue = typeof DistributionType.Type;

/**
 * What a stored profile can be: the iOS kinds above, plus `DEVELOPER_ID` — a
 * macOS profile (App Store Connect `MAC_APP_DIRECT`) a Developer ID app embeds
 * to claim entitlements Apple must authorize. iOS build configuration keeps
 * using {@link DistributionType}.
 */
export const ProfileDistributionType = Schema.Literals([
  "APP_STORE",
  "AD_HOC",
  "ENTERPRISE",
  "DEVELOPMENT",
  "DEVELOPER_ID",
]);
export type ProfileDistributionTypeValue = typeof ProfileDistributionType.Type;

export const BundleIdentifier = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9.\-_]{1,200}$/u, {
    message: "Bundle identifier must be reverse-domain style (letters, digits, dot, dash)",
  }),
);

export const AppleProvisioningProfile = Schema.Struct({
  id: Id,
  organizationId: Id,
  appleTeamId: Id,
  appleDistributionCertificateId: Schema.NullOr(Id),
  bundleIdentifier: Schema.String,
  distributionType: ProfileDistributionType,
  developerPortalIdentifier: Schema.NullOr(Schema.String),
  profileName: Schema.NullOr(Schema.String),
  validUntil: Schema.NullOr(DateTimeString),
  /** Per-row protected flag (GITLAB-RBAC-SPEC §3b): reads/uses require Maintainer+ when set. */
  protected: Schema.Boolean,
  createdAt: DateTimeString,
  updatedAt: DateTimeString,
}).annotate({ identifier: "AppleProvisioningProfile" });
export type AppleProvisioningProfile = typeof AppleProvisioningProfile.Type;

export const UploadAppleProvisioningProfileBody = Schema.Struct({
  ...credentialCreateBindingField,
  profileBase64: Schema.String.check(Schema.isMinLength(1)),
  appleDistributionCertificateId: Schema.optional(Id),
  /** SHA-256 hex of `canonicalDeviceRoster(udids)` for the roster baked into the profile. */
  deviceRosterHash: Schema.optional(Schema.String),
  isManaged: Schema.optional(Schema.Boolean),
});

export const DeleteAppleProvisioningProfileResult = DeletedResult;

export const DownloadAppleProvisioningProfileResult = Schema.Struct({
  id: Id,
  profileBase64: Schema.String,
  bundleIdentifier: Schema.String,
  distributionType: ProfileDistributionType,
  profileName: Schema.NullOr(Schema.String),
  developerPortalIdentifier: Schema.NullOr(Schema.String),
});

export const ListAppleProvisioningProfilesParams = Schema.Struct({
  bundleIdentifier: Schema.optional(BundleIdentifier),
  distributionType: Schema.optional(ProfileDistributionType),
  appleTeamId: Schema.optional(Id),
});
