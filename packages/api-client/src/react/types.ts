import type {
  AdminUser,
  AndroidApplicationIdentifier,
  AndroidBuildCredentials,
  AndroidUploadKeystore,
  AppleDistributionCertificate,
  ApplePassTypeCertificate,
  ApplePayCertificate,
  AppleProvisioningProfile,
  ApplePushCertificate,
  ApplePushKey,
  AppleTeam,
  AscApiKey,
  Branch,
  Device,
  DeviceClass,
  DeviceRegistrationRequest,
  EncryptionKeyKind,
  Environment,
  GoogleServiceAccountKey,
  Group,
  GroupMember,
  IosAppMetadata,
  IosBundleConfiguration,
  PeriodLiteral,
  Platform,
  Policy,
  PolicyAttachment,
  PolicyDocument,
  PolicyEffect,
  PolicyStatement,
  PrincipalType,
  Project,
  Submission,
  SubmissionStatus,
  UserEncryptionKey,
  VaultRecipientRef,
  VaultRecipients,
} from "@better-update/api";

export type AdminUserItem = AdminUser;
export type AnalyticsPeriod = typeof PeriodLiteral.Type;
export type PlatformValue = typeof Platform.Type;
export type ProjectItem = Project;
export type ProjectDetail = ProjectItem;
export type BranchItem = Branch;
export type DeviceItem = Device;
export type EnvironmentItem = Environment;
export type DeviceClassValue = typeof DeviceClass.Type;
export type DeviceRegistrationRequestItem = DeviceRegistrationRequest;
export type AppleTeamItem = AppleTeam;
export type AppleDistributionCertificateItem = AppleDistributionCertificate;
export type ApplePassTypeCertificateItem = ApplePassTypeCertificate;
export type ApplePayCertificateItem = ApplePayCertificate;
export type ApplePushCertificateItem = ApplePushCertificate;
export type ApplePushKeyItem = ApplePushKey;
export type AscApiKeyItem = AscApiKey;
export type AppleProvisioningProfileItem = AppleProvisioningProfile;
export type GoogleServiceAccountKeyItem = GoogleServiceAccountKey;
export type IosBundleConfigurationItem = IosBundleConfiguration;
export type AndroidApplicationIdentifierItem = AndroidApplicationIdentifier;
export type AndroidUploadKeystoreItem = AndroidUploadKeystore;
export type AndroidBuildCredentialsItem = AndroidBuildCredentials;
export type IosAppMetadataItem = IosAppMetadata;
export type SubmissionItem = Submission;
export type SubmissionStatusValue = typeof SubmissionStatus.Type;
export type UserEncryptionKeyItem = UserEncryptionKey;
export type EncryptionKeyKindValue = EncryptionKeyKind;
export type VaultRecipientItem = typeof VaultRecipientRef.Type;
export type VaultRecipientsResult = typeof VaultRecipients.Type;
export type PolicyItem = Policy;
export type PolicyDocumentValue = typeof PolicyDocument.Type;
export type PolicyStatementValue = typeof PolicyStatement.Type;
export type PolicyEffectValue = typeof PolicyEffect.Type;
export type GroupItem = Group;
export type GroupMemberItem = GroupMember;
export type PolicyAttachmentItem = PolicyAttachment;
export type PrincipalTypeValue = typeof PrincipalType.Type;
