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
  OrgRole,
  ProjectRole,
  Resource,
  Role,
} from "./auth/context";

// Domain schemas
export { AdminUser, AdminUserStatus, ListAdminUsersParams } from "./domain/admin";
export { AuditLog, AuditLogResourceType, AuditLogSource } from "./domain/audit-log";
export {
  csvList,
  DateTimeString,
  Id,
  PaginationParams,
  Platform,
  UpdateRolloutBody,
  UploadHeaders,
  UuidLower,
} from "./domain/common";
export { BadRequest, Conflict, NotAcceptable } from "./domain/errors";
export {
  CreateProjectBody,
  DeleteProjectResult,
  ListProjectsParams,
  Project,
  ProjectLogoContentType,
  ProjectLogoUploadBody,
  ProjectLogoUploadResult,
  ProjectSort,
  ProjectSortColumn,
  UpdateProjectBody,
} from "./domain/project";
export {
  Branch,
  BranchSort,
  BranchSortColumn,
  CreateBranchBody,
  DeleteBranchResult,
  UpdateBranchBody,
} from "./domain/branch";
export {
  Channel,
  ChannelSort,
  ChannelSortColumn,
  CreateBranchRolloutBody,
  CreateChannelBody,
  DeleteChannelResult,
  UpdateChannelBody,
} from "./domain/channel";
export { ListRuntimesParams, RuntimeAggregate } from "./domain/runtime";
export {
  BUILTIN_ENVIRONMENTS,
  CreateEnvironmentBody,
  DeleteEnvironmentResult,
  Environment,
  EnvironmentListResult,
  EnvironmentName,
  RenameEnvironmentBody,
} from "./domain/environment";
export {
  AssetRef,
  CreateUpdateBody,
  DeleteUpdateResult,
  ListPatchBasesParams,
  PatchBaseCandidate,
  RepublishBody,
  RepublishResult,
  Update,
  UpdateAssetEntry,
  UpdateSort,
  UpdateSortColumn,
} from "./domain/update";
export {
  Asset,
  AssetUploadBody,
  AssetUploadResult,
  PatchUploadBody,
  PatchUploadResult,
} from "./domain/asset";
export {
  BulkImportEntry,
  BulkImportEnvVarsBody,
  BulkImportResult,
  CreateEnvVarBody,
  DeleteEnvVarResult,
  EnvVar,
  EnvVarDescription,
  EnvVarDescriptionText,
  EnvVarEnvironment,
  EnvVarExportItem,
  EnvVarExportResult,
  EnvVarLabel,
  EnvVarListScope,
  EnvVarRevision,
  EnvVarRevisionsResult,
  EnvVarScope,
  EnvVarValueEnvelope,
  EnvVarVisibility,
  resolveEnvVarOverrides,
  RollbackEnvVarBody,
  UpdateEnvVarBody,
  UpsertEnvVarDescriptionBody,
} from "./domain/env-var";
export {
  canonicalDeviceRoster,
  CreateRegistrationRequestBody,
  DeleteDeviceResult,
  Device,
  DeviceClass,
  DeviceIdentifier,
  DeviceRegistrationRequest,
  DeviceSort,
  DeviceSortColumn,
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
  ApplePushCertificate,
  DeleteApplePushCertificateResult,
  UploadApplePushCertificateBody,
} from "./domain/apple-push-certificate";
export {
  ApplePayCertificate,
  DeleteApplePayCertificateResult,
  UploadApplePayCertificateBody,
} from "./domain/apple-pay-certificate";
export {
  ApplePassTypeCertificate,
  DeleteApplePassTypeCertificateResult,
  UploadApplePassTypeCertificateBody,
} from "./domain/apple-pass-type-certificate";
export {
  AscApiKey,
  AscApiKeyCredentials,
  AscApiKeyId,
  DeleteAscApiKeyResult,
  IssuerId,
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
  AppName,
  AppStoreLanguage,
  AppStoreSku,
  AscAppId,
  CompanyName,
  CreateIosAppMetadataBody,
  DeleteIosAppMetadataResult,
  IosAppMetadata,
  UpdateIosAppMetadataBody,
} from "./domain/ios-app-metadata";
export {
  AndroidReleaseStatus,
  AndroidSubmissionConfig,
  AndroidTrack,
  CreateAndroidSubmissionBody,
  CreateIosSubmissionBody,
  CreateSubmissionBody,
  DeleteSubmissionResult,
  IosSubmissionConfig,
  Rollout,
  Submission,
  SubmissionArchiveSource,
} from "./domain/submission";
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
  BuildAudience,
  BuildSort,
  BuildSortColumn,
  BuildWithArtifact,
  CompleteBuildBody,
  CreateBuildBody,
  DeleteBuildResult,
  Distribution,
  INTERNAL_DISTRIBUTIONS,
  InstallLinkResult,
  isOtaInstallableDistribution,
  OTA_INSTALLABLE_DISTRIBUTIONS,
  ReserveBuildResult,
  STORE_DISTRIBUTIONS,
} from "./domain/build";
export {
  BuildCompatibilityChannel,
  BuildCompatibilityMatrixResult,
  CompatibilityChannelInfo,
  MissingRuntimeVersionBuild,
} from "./domain/build-compatibility";
export {
  BuildDebugArtifact,
  CompleteDebugArtifactBody,
  CompleteSourcemapBody,
  DebugArtifactType,
  DebugDownloadResult,
  DebugUploadReservation,
  ListDebugArtifactsResult,
  ReserveDebugArtifactBody,
  ReserveSourcemapBody,
  UpdateSourcemap,
} from "./domain/debug-artifact";
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
export {
  AgeRecipient,
  EncryptionKeyKind,
  KeyFingerprint,
  RegisterEncryptionKeyBody,
  UserEncryptionKey,
} from "./domain/user-encryption-key";
export {
  AddVaultWrapBody,
  BootstrapVaultBody,
  EnvVaultRecipientKind,
  EnvVaultWrapInput,
  OrgVault,
  OrgVaultKeyWrap,
  RecipientVaultKey,
  VaultRecipientRef,
  VaultRecipients,
  VaultVersion,
  VaultWrapInput,
} from "./domain/org-vault";
export {
  AccountKey,
  AccountKeyEscrow,
  AccountKeyKdfParams,
  AccountKeyList,
  Ed25519PublicKey,
  RegisterAccountKeyBody,
  ResealAccountKeyBody,
} from "./domain/account-key";
export {
  AddEnvVaultWrapBody,
  CutoverEnvVaultBody,
  EnvVaultCredentialDeks,
  EnvVaultDekRef,
  EnvVaultDekUpdate,
  EnvVaultRecipientRef,
  EnvVaultRecipients,
  OrgEnvVaultKeyWrap,
  RecipientEnvVaultKey,
  RotateEnvVaultBody,
} from "./domain/env-vault";
export {
  PasskeyStepUpBody,
  PasskeyStepUpResult,
  WEB_ENV_STEP_UP_REQUIRED_MESSAGE,
  WEB_ENV_STEP_UP_TTL_MS,
} from "./domain/web-vault";
export {
  Ciphertext,
  CredentialDekRef,
  CredentialDekUpdate,
  CredentialType,
  encryptedEnvelopeFields,
  RotateVaultBody,
  VaultCredentialDeks,
  WrappedDek,
} from "./domain/encrypted-credential";
export {
  CreatedRobotAccount,
  CreateRobotAccountBody,
  RobotAccount,
  RobotAccountList,
  RotatedRobotAccountBearer,
  UpdateRobotAccountBody,
} from "./domain/robot-account";
export {
  CreateInvitationBody,
  Invitation,
  InvitationList,
  InvitationProjectGrant,
} from "./domain/invitation";
export {
  boundProjectIdsField,
  CredentialBinding,
  CredentialBindingList,
  CredentialBindingPlan,
  CredentialBindingPlanItem,
  CredentialBindingType,
  credentialCreateBindingField,
  OrgCredentialBinding,
} from "./domain/credential-binding";
export type { CredentialBindingTypeValue } from "./domain/credential-binding";
export {
  AllProjectsMembership,
  MemberProjectMembership,
  MemberProjectMemberships,
  MemberProjectMembershipsList,
  ProjectMember,
  ProjectMemberList,
  ProjectMemberPrincipalType,
  ProjectMemberRole,
  RemoveProjectMemberParams,
  SetAllProjectsMembershipBody,
  UpdateProjectMemberBody,
  UpsertProjectMemberBody,
} from "./domain/project-member";

// Groups
export { AdminGroup } from "./groups/admin";
export { AuditLogsGroup } from "./groups/audit-logs";
export { AnalyticsGroup } from "./groups/analytics";
export { AssetsGroup } from "./groups/assets";
export { BranchesGroup } from "./groups/branches";
export { RuntimesGroup } from "./groups/runtimes";
export { BuildsGroup } from "./groups/builds";
export { EnvVarsGroup } from "./groups/env-vars";
export { EnvironmentsGroup } from "./groups/environments";
export { ChannelsGroup } from "./groups/channels";
export { FingerprintDetail, FingerprintsGroup } from "./groups/fingerprints";
export { DevicesGroup } from "./groups/devices";
export { AppleTeamsGroup } from "./groups/apple-teams";
export { AppleDistributionCertificatesGroup } from "./groups/apple-distribution-certificates";
export { ApplePushKeysGroup } from "./groups/apple-push-keys";
export { ApplePushCertificatesGroup } from "./groups/apple-push-certificates";
export { ApplePayCertificatesGroup } from "./groups/apple-pay-certificates";
export { ApplePassTypeCertificatesGroup } from "./groups/apple-pass-type-certificates";
export { AscApiKeysGroup } from "./groups/asc-api-keys";
export { AppleProvisioningProfilesGroup } from "./groups/apple-provisioning-profiles";
export { GoogleServiceAccountKeysGroup } from "./groups/google-service-account-keys";
export { IosBundleConfigurationsGroup } from "./groups/ios-bundle-configurations";
export { IosAppMetadataGroup } from "./groups/ios-app-metadata";
export { SubmissionsGroup } from "./groups/submissions";
export { AndroidApplicationIdentifiersGroup } from "./groups/android-application-identifiers";
export { AndroidUploadKeystoresGroup } from "./groups/android-upload-keystores";
export { AndroidBuildCredentialsGroup } from "./groups/android-build-credentials";
export { BuildCredentialsGroup } from "./groups/build-credentials";
export { UserEncryptionKeysGroup } from "./groups/user-encryption-keys";
export { OrgVaultGroup } from "./groups/org-vault";
export { AccountKeysGroup } from "./groups/account-keys";
export { EnvVaultGroup } from "./groups/env-vault";
export { WebVaultGroup } from "./groups/web-vault";
export { ManifestGroup } from "./groups/manifest";
export { MeGroup } from "./groups/me";
export { ProjectsGroup } from "./groups/projects";
export { UpdatesGroup } from "./groups/updates";
export { WebhooksGroup } from "./groups/webhooks";
export { RobotAccountsGroup } from "./groups/robot-accounts";
export { InvitationsGroup } from "./groups/invitations";
export { MembersGroup } from "./groups/members";
export { ProjectMembersGroup } from "./groups/project-members";
export { CredentialBindingsGroup } from "./groups/credential-bindings";
export { OrganizationGroup } from "./groups/organization";
export {
  Organization,
  OrganizationLogoContentType,
  OrganizationLogoUploadBody,
  OrganizationLogoUploadResult,
  UpdateOrganizationBody,
} from "./domain/organization";

export {
  AvatarContentType,
  AvatarResult,
  AvatarUploadBody,
  AvatarUploadResult,
  Me,
  MeOrganization,
  MeUser,
} from "./domain/me";
export {
  CreateWebhookBody,
  DeleteWebhookResult,
  UpdateWebhookBody,
  Webhook,
  WebhookEventName,
  WebhookWithSecret,
} from "./domain/webhook";
