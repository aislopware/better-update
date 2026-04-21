import type {
  AndroidApplicationIdentifier,
  AndroidBuildCredentials,
  AndroidUploadKeystore,
  AppleDistributionCertificate,
  AppleProvisioningProfile,
  ApplePushKey,
  AppleTeam,
  AscApiKey,
  Branch,
  Device,
  DeviceClass,
  DeviceRegistrationRequest,
  GoogleServiceAccountKey,
  IosBundleConfiguration,
  PeriodLiteral,
  Platform,
  Project,
  SyncDevicesResult,
} from "@better-update/api";

export type AnalyticsPeriod = typeof PeriodLiteral.Type;
export type PlatformValue = typeof Platform.Type;
export type ProjectItem = typeof Project.Type;
export type ProjectDetail = ProjectItem;
export type BranchItem = typeof Branch.Type;
export type DeviceItem = typeof Device.Type;
export type DeviceClassValue = typeof DeviceClass.Type;
export type DeviceRegistrationRequestItem = typeof DeviceRegistrationRequest.Type;
export type SyncDevicesResultValue = typeof SyncDevicesResult.Type;
export type AppleTeamItem = typeof AppleTeam.Type;
export type AppleDistributionCertificateItem = typeof AppleDistributionCertificate.Type;
export type ApplePushKeyItem = typeof ApplePushKey.Type;
export type AscApiKeyItem = typeof AscApiKey.Type;
export type AppleProvisioningProfileItem = typeof AppleProvisioningProfile.Type;
export type GoogleServiceAccountKeyItem = typeof GoogleServiceAccountKey.Type;
export type IosBundleConfigurationItem = typeof IosBundleConfiguration.Type;
export type AndroidApplicationIdentifierItem = typeof AndroidApplicationIdentifier.Type;
export type AndroidUploadKeystoreItem = typeof AndroidUploadKeystore.Type;
export type AndroidBuildCredentialsItem = typeof AndroidBuildCredentials.Type;
