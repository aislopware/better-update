import { Schema } from "effect";

import { AndroidPackageName } from "./android-application-identifier";
import { BundleIdentifier, DistributionType } from "./apple-provisioning-profile";
import { Id, Name120 } from "./common";
import { encryptedEnvelopeFields } from "./encrypted-credential";

export const ResolveBuildCredentialsIosBody = Schema.Struct({
  platform: Schema.Literal("ios"),
  bundleIdentifier: BundleIdentifier,
  distributionType: DistributionType,
});

export const ResolveBuildCredentialsAndroidBody = Schema.Struct({
  platform: Schema.Literal("android"),
  applicationIdentifier: AndroidPackageName,
  buildProfile: Schema.optional(Name120),
});

export const ResolveBuildCredentialsBody = Schema.Union(
  ResolveBuildCredentialsIosBody,
  ResolveBuildCredentialsAndroidBody,
);

/** Encrypted `.p12` envelope; the CLI decrypts to `{ p12Base64, p12Password }` during the build. */
export const IosBuildDistributionCertificate = Schema.Struct({
  ...encryptedEnvelopeFields,
});

export const IosBuildProvisioningProfile = Schema.Struct({
  mobileprovisionBase64: Schema.String,
  uuid: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  teamId: Schema.String,
  bundleIdentifier: Schema.String,
  distributionType: DistributionType,
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
  profileStale: Schema.Boolean,
  currentDeviceRosterHash: Schema.NullOr(Schema.String),
  context: IosBuildContext,
});

/** Encrypted keystore envelope + the keystore row id (the DEK-AAD `credentialId`) and public alias; the CLI decrypts to `{ keystoreBase64, keystorePassword, keyPassword }`. */
export const AndroidBuildKeystore = Schema.Struct({
  ...encryptedEnvelopeFields,
  id: Id,
  keyAlias: Schema.String,
});

export const ResolveBuildCredentialsAndroidResult = Schema.Struct({
  platform: Schema.Literal("android"),
  keystore: AndroidBuildKeystore,
});

export const ResolveBuildCredentialsResult = Schema.Union(
  ResolveBuildCredentialsIosResult,
  ResolveBuildCredentialsAndroidResult,
);
