import { Layer } from "effect";

import { AnalyticsEngineLive } from "./cloudflare/analytics-engine";
import { AssetStorageLive } from "./cloudflare/asset-storage";
import { BuildRuntimeLive } from "./cloudflare/build-runtime";
import { CredentialArtifactsLive } from "./cloudflare/credential-artifacts";
import { CryptoServiceLive } from "./cloudflare/crypto-service";
import { EmailServiceLive } from "./cloudflare/email-service";
import { ManifestCacheStorageLive } from "./cloudflare/manifest-cache-storage";
import { UpdateCoordinatorLive } from "./cloudflare/update-coordinator";
import {
  AccountKeyRepoLive,
  AdminUsersRepoLive,
  AnalyticsRepoLive,
  AndroidApplicationIdentifierRepoLive,
  AndroidBuildCredentialsRepoLive,
  AndroidUploadKeystoreRepoLive,
  AppleDistributionCertificateRepoLive,
  ApplePassTypeCertificateRepoLive,
  ApplePayCertificateRepoLive,
  AppleProvisioningProfileRepoLive,
  ApplePushCertificateRepoLive,
  ApplePushKeyRepoLive,
  AppleTeamRepoLive,
  AscApiKeyRepoLive,
  AssetRepoLive,
  AuditLogRepoLive,
  AuthMetaRepoLive,
  BranchRepoLive,
  BuildRepoLive,
  BundleRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  DeviceRegistrationRequestRepoLive,
  DeviceRepoLive,
  EnvironmentRepoLive,
  EnvVarRepoLive,
  GoogleServiceAccountKeyRepoLive,
  InvitationProjectGrantRepoLive,
  IosAppMetadataRepoLive,
  IosBundleConfigurationRepoLive,
  OrgEnvVaultRepoLive,
  OrgVaultRepoLive,
  PasskeyStepUpRepoLive,
  ProjectCredentialBindingRepoLive,
  ProjectMemberRepoLive,
  ProjectRepoLive,
  ProtectedEnvironmentRepoLive,
  RuntimeRepoLive,
  SubmissionsRepoLive,
  UpdateRepoLive,
  UserEncryptionKeyRepoLive,
  WebhookRepoLive,
} from "./repositories";
import { InvitationRepoLive } from "./repositories/invitations";
import { MemberRepoLive } from "./repositories/member-repo";
import { OrganizationRepoLive } from "./repositories/organizations";
import { RobotAccountRepoLive } from "./repositories/robot-accounts";

import type { AnalyticsEngine } from "./cloudflare/analytics-engine";
import type { AssetStorage } from "./cloudflare/asset-storage";
import type { BuildRuntime } from "./cloudflare/build-runtime";
import type { CredentialArtifacts } from "./cloudflare/credential-artifacts";
import type { ManifestCacheStorage } from "./cloudflare/manifest-cache-storage";
import type { UpdateCoordinator } from "./cloudflare/update-coordinator";
import type { CryptoService } from "./domain/crypto-service";
import type { EmailService } from "./domain/email-service";
import type {
  AccountKeyRepo,
  AdminUsersRepo,
  AnalyticsRepo,
  AndroidApplicationIdentifierRepo,
  AndroidBuildCredentialsRepo,
  AndroidUploadKeystoreRepo,
  AppleDistributionCertificateRepo,
  ApplePassTypeCertificateRepo,
  ApplePayCertificateRepo,
  AppleProvisioningProfileRepo,
  ApplePushCertificateRepo,
  ApplePushKeyRepo,
  AppleTeamRepo,
  AscApiKeyRepo,
  AssetRepo,
  AuditLogRepo,
  AuthMetaRepo,
  BranchRepo,
  BuildRepo,
  BundleRepo,
  ChannelRepo,
  CompatibilityRepo,
  DeviceRegistrationRequestRepo,
  DeviceRepo,
  EnvironmentRepo,
  EnvVarRepo,
  GoogleServiceAccountKeyRepo,
  InvitationProjectGrantRepo,
  IosAppMetadataRepo,
  IosBundleConfigurationRepo,
  OrgEnvVaultRepo,
  OrgVaultRepo,
  PasskeyStepUpRepo,
  ProjectMemberRepo,
  ProjectRepo,
  ProtectedEnvironmentRepo,
  RuntimeRepo,
  SubmissionsRepo,
  UpdateRepo,
  UserEncryptionKeyRepo,
  WebhookRepo,
} from "./repositories";
import type { InvitationRepo } from "./repositories/invitations";
import type { MemberRepo } from "./repositories/member-repo";
import type { OrganizationRepo } from "./repositories/organizations";
import type { RobotAccountRepo } from "./repositories/robot-accounts";

export type ServerInfrastructure =
  | AccountKeyRepo
  | AdminUsersRepo
  | AnalyticsEngine
  | AnalyticsRepo
  | AndroidApplicationIdentifierRepo
  | AndroidBuildCredentialsRepo
  | AndroidUploadKeystoreRepo
  | AppleDistributionCertificateRepo
  | ApplePassTypeCertificateRepo
  | ApplePayCertificateRepo
  | AppleProvisioningProfileRepo
  | ApplePushCertificateRepo
  | ApplePushKeyRepo
  | AppleTeamRepo
  | AscApiKeyRepo
  | AssetRepo
  | AssetStorage
  | AuditLogRepo
  | AuthMetaRepo
  | BranchRepo
  | BuildRepo
  | BuildRuntime
  | BundleRepo
  | ChannelRepo
  | CompatibilityRepo
  | CredentialArtifacts
  | CryptoService
  | DeviceRegistrationRequestRepo
  | DeviceRepo
  | EmailService
  | EnvironmentRepo
  | EnvVarRepo
  | GoogleServiceAccountKeyRepo
  | InvitationProjectGrantRepo
  | InvitationRepo
  | IosAppMetadataRepo
  | IosBundleConfigurationRepo
  | ManifestCacheStorage
  | MemberRepo
  | OrganizationRepo
  | ProjectMemberRepo
  | OrgEnvVaultRepo
  | OrgVaultRepo
  | PasskeyStepUpRepo
  | ProjectRepo
  | ProtectedEnvironmentRepo
  | RobotAccountRepo
  | RuntimeRepo
  | SubmissionsRepo
  | UpdateCoordinator
  | UpdateRepo
  | UserEncryptionKeyRepo
  | WebhookRepo;

export const RepositoryLayer = Layer.mergeAll(
  AccountKeyRepoLive,
  AdminUsersRepoLive,
  AnalyticsRepoLive,
  AndroidApplicationIdentifierRepoLive,
  AndroidBuildCredentialsRepoLive,
  AndroidUploadKeystoreRepoLive,
  AppleDistributionCertificateRepoLive,
  ApplePassTypeCertificateRepoLive,
  ApplePayCertificateRepoLive,
  AppleProvisioningProfileRepoLive,
  ApplePushCertificateRepoLive,
  ApplePushKeyRepoLive,
  AppleTeamRepoLive,
  AscApiKeyRepoLive,
  AssetRepoLive,
  AuditLogRepoLive,
  AuthMetaRepoLive,
  BranchRepoLive,
  BuildRepoLive,
  BundleRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  DeviceRegistrationRequestRepoLive,
  DeviceRepoLive,
  EnvironmentRepoLive,
  EnvVarRepoLive,
  GoogleServiceAccountKeyRepoLive,
  InvitationProjectGrantRepoLive,
  InvitationRepoLive,
  IosAppMetadataRepoLive,
  IosBundleConfigurationRepoLive,
  MemberRepoLive,
  OrganizationRepoLive,
  OrgEnvVaultRepoLive,
  OrgVaultRepoLive,
  PasskeyStepUpRepoLive,
  ProjectCredentialBindingRepoLive,
  ProjectMemberRepoLive,
  ProjectRepoLive,
  ProtectedEnvironmentRepoLive,
  RobotAccountRepoLive,
  RuntimeRepoLive,
  SubmissionsRepoLive,
  UpdateRepoLive,
  UserEncryptionKeyRepoLive,
  WebhookRepoLive,
);

export const AdapterLayer = Layer.mergeAll(
  AnalyticsEngineLive,
  AssetStorageLive,
  BuildRuntimeLive,
  CredentialArtifactsLive,
  CryptoServiceLive,
  EmailServiceLive,
  ManifestCacheStorageLive,
  UpdateCoordinatorLive,
);

export const ServerInfrastructureLayer = Layer.merge(
  AdapterLayer,
  RepositoryLayer.pipe(Layer.provide(AdapterLayer)),
);
