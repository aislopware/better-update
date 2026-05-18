import { Schema } from "effect";

import { AndroidPackageName } from "./android-application-identifier";
import { BundleIdentifier, DistributionType } from "./apple-provisioning-profile";

export const ResolveBuildCredentialsIosBody = Schema.Struct({
  platform: Schema.Literal("ios"),
  bundleIdentifier: BundleIdentifier,
  distributionType: DistributionType,
});

export const ResolveBuildCredentialsAndroidBody = Schema.Struct({
  platform: Schema.Literal("android"),
  applicationIdentifier: AndroidPackageName,
  buildProfile: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(120))),
});

export const ResolveBuildCredentialsBody = Schema.Union(
  ResolveBuildCredentialsIosBody,
  ResolveBuildCredentialsAndroidBody,
);

export const IosBuildDistributionCertificate = Schema.Struct({
  p12Base64: Schema.String,
  p12Password: Schema.String,
});

export const IosBuildProvisioningProfile = Schema.Struct({
  mobileprovisionBase64: Schema.String,
  uuid: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  teamId: Schema.String,
  bundleIdentifier: Schema.String,
  distributionType: DistributionType,
});

export const IosBuildPushKey = Schema.Struct({
  p8Base64: Schema.String,
  keyId: Schema.String,
  teamId: Schema.String,
});

/**
 * Auto-provision context surfaced to the CLI. When `ascApiKeyId` is present,
 * the CLI may use it to generate missing provisioning profiles for extension
 * targets (auto-provision flow). `distributionCertificateId` + `appleTeamId`
 * are backend row ids; `appleTeamIdentifier` is the 10-char Apple portal team
 * id (e.g. "ABCDE12345").
 */
export const IosBuildContext = Schema.Struct({
  ascApiKeyId: Schema.NullOr(Schema.String),
  distributionCertificateId: Schema.String,
  appleTeamId: Schema.String,
  appleTeamIdentifier: Schema.String,
});

export const ResolveBuildCredentialsIosResult = Schema.Struct({
  platform: Schema.Literal("ios"),
  distributionCertificate: IosBuildDistributionCertificate,
  provisioningProfile: IosBuildProvisioningProfile,
  pushKey: Schema.NullOr(IosBuildPushKey),
  profileStale: Schema.Boolean,
  currentDeviceRosterHash: Schema.NullOr(Schema.String),
  context: IosBuildContext,
});

export const AndroidBuildKeystore = Schema.Struct({
  keystoreBase64: Schema.String,
  storePassword: Schema.String,
  keyAlias: Schema.String,
  keyPassword: Schema.String,
});

export const ResolveBuildCredentialsAndroidResult = Schema.Struct({
  platform: Schema.Literal("android"),
  keystore: AndroidBuildKeystore,
});

export const ResolveBuildCredentialsResult = Schema.Union(
  ResolveBuildCredentialsIosResult,
  ResolveBuildCredentialsAndroidResult,
);
