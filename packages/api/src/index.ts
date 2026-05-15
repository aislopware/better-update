// Root API
export { ManagementApi } from "./api";
export { ProtocolApi } from "./protocol-api";

// Auth
export { AuthContext } from "./auth/context";
export { Authentication } from "./auth/middleware";
export { Forbidden, OrgRequired, Unauthorized } from "./auth/errors";
export { NotFound } from "./auth/ownership";

export type {
  Action,
  AuthContextShape,
  EffectivePermissions,
  Resource,
  Role,
} from "./auth/context";

// Domain schemas
export { AuditLog, AuditLogResourceType, AuditLogSource } from "./domain/audit-log";
export {
  DateTimeString,
  Id,
  PaginationParams,
  Platform,
  UpdateRolloutBody,
  UploadHeaders,
} from "./domain/common";
export { BadRequest, Conflict, NotAcceptable } from "./domain/errors";
export {
  CreateProjectBody,
  DeleteProjectResult,
  ListProjectsParams,
  Project,
  ProjectSort,
  UpdateProjectBody,
} from "./domain/project";
export { Branch, CreateBranchBody, DeleteBranchResult, UpdateBranchBody } from "./domain/branch";
export {
  Channel,
  CreateBranchRolloutBody,
  CreateChannelBody,
  DeleteChannelResult,
  UpdateChannelBody,
} from "./domain/channel";
export {
  AssetRef,
  CreateUpdateBody,
  DeleteUpdateResult,
  RepublishBody,
  RepublishResult,
  Update,
} from "./domain/update";
export { Asset, AssetUploadBody, AssetUploadResult } from "./domain/asset";
export {
  BulkImportEnvVarsBody,
  BulkImportResult,
  CreateEnvVarBody,
  DeleteEnvVarResult,
  EnvVar,
  EnvVarEnvironment,
  EnvVarExportItem,
  EnvVarExportResult,
  EnvVarListScope,
  EnvVarScope,
  EnvVarVisibility,
  UpdateEnvVarBody,
} from "./domain/env-var";
export {
  CreateRegistrationRequestBody,
  DeleteDeviceResult,
  Device,
  DeviceClass,
  DeviceIdentifier,
  DeviceRegistrationRequest,
  ListDevicesParams,
  ListRegistrationRequestsParams,
  RegisterDeviceBody,
  UpdateDeviceBody,
} from "./domain/device";
export { AppleTeam, AppleTeamIdentifier, AppleTeamType } from "./domain/apple-team";
export {
  AppleDistributionCertificate,
  DeleteAppleDistributionCertificateResult,
  UploadAppleDistributionCertificateBody,
} from "./domain/apple-distribution-certificate";
export {
  ApplePushKey,
  ApplePushKeyId,
  DeleteApplePushKeyResult,
  UploadApplePushKeyBody,
} from "./domain/apple-push-key";
export {
  AscApiKey,
  AscApiKeyCredentials,
  AscApiKeyId,
  DeleteAscApiKeyResult,
  IssuerId,
  SyncDevicesResult,
  SyncedDeviceSummary,
  UploadAscApiKeyBody,
} from "./domain/asc-api-key";
export {
  AppleProvisioningProfile,
  BundleIdentifier,
  DeleteAppleProvisioningProfileResult,
  DistributionType,
  ListAppleProvisioningProfilesParams,
  UploadAppleProvisioningProfileBody,
} from "./domain/apple-provisioning-profile";
export {
  DeleteGoogleServiceAccountKeyResult,
  GoogleServiceAccountKey,
  UploadGoogleServiceAccountKeyBody,
} from "./domain/google-service-account-key";
export {
  CreateIosBundleConfigurationBody,
  DeleteIosBundleConfigurationResult,
  IosBundleConfiguration,
  UpdateIosBundleConfigurationBody,
} from "./domain/ios-bundle-configuration";
export {
  AndroidApplicationIdentifier,
  AndroidPackageName,
  CreateAndroidApplicationIdentifierBody,
  DeleteAndroidApplicationIdentifierResult,
} from "./domain/android-application-identifier";
export {
  AndroidUploadKeystore,
  DeleteAndroidUploadKeystoreResult,
  UploadAndroidUploadKeystoreBody,
} from "./domain/android-upload-keystore";
export {
  AndroidBuildCredentials,
  CreateAndroidBuildCredentialsBody,
  DeleteAndroidBuildCredentialsResult,
  UpdateAndroidBuildCredentialsBody,
} from "./domain/android-build-credentials";
export {
  AndroidBuildKeystore,
  IosBuildDistributionCertificate,
  IosBuildProvisioningProfile,
  IosBuildPushKey,
  ResolveBuildCredentialsAndroidBody,
  ResolveBuildCredentialsAndroidResult,
  ResolveBuildCredentialsBody,
  ResolveBuildCredentialsIosBody,
  ResolveBuildCredentialsIosResult,
  ResolveBuildCredentialsResult,
} from "./domain/build-credentials";
export {
  ArtifactFormat,
  Build,
  BuildArtifact,
  BuildWithArtifact,
  CompleteBuildBody,
  CreateBuildBody,
  DeleteBuildResult,
  Distribution,
  InstallLinkResult,
  ReserveBuildResult,
} from "./domain/build";
export {
  BuildCompatibilityChannel,
  BuildCompatibilityMatrixResult,
  CompatibilityChannelInfo,
  MissingRuntimeVersionBuild,
} from "./domain/build-compatibility";
export {
  AdoptionParams,
  AdoptionResult,
  ChannelAnalyticsParams,
  ChannelAnalyticsResult,
  PeriodLiteral,
  PlatformParams,
  PlatformResult,
  UpdateAnalyticsParams,
  UpdateAnalyticsResult,
} from "./domain/analytics";

// Groups
export { AuditLogsGroup } from "./groups/audit-logs";
export { AnalyticsGroup } from "./groups/analytics";
export { AssetsGroup } from "./groups/assets";
export { BranchesGroup } from "./groups/branches";
export { BuildsGroup } from "./groups/builds";
export { EnvVarsGroup } from "./groups/env-vars";
export { ChannelsGroup } from "./groups/channels";
export { DevicesGroup } from "./groups/devices";
export { AppleTeamsGroup } from "./groups/apple-teams";
export { AppleDistributionCertificatesGroup } from "./groups/apple-distribution-certificates";
export { ApplePushKeysGroup } from "./groups/apple-push-keys";
export { AscApiKeysGroup } from "./groups/asc-api-keys";
export { AppleProvisioningProfilesGroup } from "./groups/apple-provisioning-profiles";
export { GoogleServiceAccountKeysGroup } from "./groups/google-service-account-keys";
export { IosBundleConfigurationsGroup } from "./groups/ios-bundle-configurations";
export { AndroidApplicationIdentifiersGroup } from "./groups/android-application-identifiers";
export { AndroidUploadKeystoresGroup } from "./groups/android-upload-keystores";
export { AndroidBuildCredentialsGroup } from "./groups/android-build-credentials";
export { BuildCredentialsGroup } from "./groups/build-credentials";
export { ManifestGroup } from "./groups/manifest";
export { MeGroup } from "./groups/me";
export { ProjectsGroup } from "./groups/projects";
export { UpdatesGroup } from "./groups/updates";
export { WebhooksGroup } from "./groups/webhooks";

export { Me, MeOrganization, MeUser } from "./domain/me";
export {
  CreateWebhookBody,
  DeleteWebhookResult,
  UpdateWebhookBody,
  Webhook,
  WebhookEventName,
  WebhookWithSecret,
} from "./domain/webhook";
