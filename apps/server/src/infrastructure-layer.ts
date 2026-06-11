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
  AdminUsersRepoLive,
  AnalyticsRepoLive,
  AndroidApplicationIdentifierRepoLive,
  AndroidBuildCredentialsRepoLive,
  AndroidUploadKeystoreRepoLive,
  AppleDistributionCertificateRepoLive,
  AppleProvisioningProfileRepoLive,
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
  IosAppMetadataRepoLive,
  IosBundleConfigurationRepoLive,
  OrgVaultRepoLive,
  ProjectRepoLive,
  RuntimeRepoLive,
  SubmissionsRepoLive,
  UpdateRepoLive,
  UserEncryptionKeyRepoLive,
  WebhookRepoLive,
} from "./repositories";
import { ApiKeyRepoLive } from "./repositories/api-keys";
import { GroupRepoLive } from "./repositories/group-repo";
import { InvitationRepoLive } from "./repositories/invitations";
import { MemberRepoLive } from "./repositories/member-repo";
import { OrganizationRepoLive } from "./repositories/organizations";
import { PolicyAttachmentRepoLive } from "./repositories/policy-attachment-repo";
import { PolicyRepoLive } from "./repositories/policy-repo";

import type { AnalyticsEngine } from "./cloudflare/analytics-engine";
import type { AssetStorage } from "./cloudflare/asset-storage";
import type { BuildRuntime } from "./cloudflare/build-runtime";
import type { CredentialArtifacts } from "./cloudflare/credential-artifacts";
import type { ManifestCacheStorage } from "./cloudflare/manifest-cache-storage";
import type { UpdateCoordinator } from "./cloudflare/update-coordinator";
import type { CryptoService } from "./domain/crypto-service";
import type { EmailService } from "./domain/email-service";
import type {
  AdminUsersRepo,
  AnalyticsRepo,
  AndroidApplicationIdentifierRepo,
  AndroidBuildCredentialsRepo,
  AndroidUploadKeystoreRepo,
  AppleDistributionCertificateRepo,
  AppleProvisioningProfileRepo,
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
  IosAppMetadataRepo,
  IosBundleConfigurationRepo,
  OrgVaultRepo,
  ProjectRepo,
  RuntimeRepo,
  SubmissionsRepo,
  UpdateRepo,
  UserEncryptionKeyRepo,
  WebhookRepo,
} from "./repositories";
import type { ApiKeyRepo } from "./repositories/api-keys";
import type { GroupRepo } from "./repositories/group-repo";
import type { InvitationRepo } from "./repositories/invitations";
import type { MemberRepo } from "./repositories/member-repo";
import type { OrganizationRepo } from "./repositories/organizations";
import type { PolicyAttachmentRepo } from "./repositories/policy-attachment-repo";
import type { PolicyRepo } from "./repositories/policy-repo";

export type ServerInfrastructure =
  | AdminUsersRepo
  | AnalyticsEngine
  | AnalyticsRepo
  | AndroidApplicationIdentifierRepo
  | AndroidBuildCredentialsRepo
  | AndroidUploadKeystoreRepo
  | ApiKeyRepo
  | AppleDistributionCertificateRepo
  | AppleProvisioningProfileRepo
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
  | GroupRepo
  | InvitationRepo
  | IosAppMetadataRepo
  | IosBundleConfigurationRepo
  | ManifestCacheStorage
  | MemberRepo
  | OrganizationRepo
  | PolicyAttachmentRepo
  | PolicyRepo
  | OrgVaultRepo
  | ProjectRepo
  | RuntimeRepo
  | SubmissionsRepo
  | UpdateCoordinator
  | UpdateRepo
  | UserEncryptionKeyRepo
  | WebhookRepo;

export const RepositoryLayer = Layer.mergeAll(
  AdminUsersRepoLive,
  AnalyticsRepoLive,
  AndroidApplicationIdentifierRepoLive,
  AndroidBuildCredentialsRepoLive,
  AndroidUploadKeystoreRepoLive,
  ApiKeyRepoLive,
  AppleDistributionCertificateRepoLive,
  AppleProvisioningProfileRepoLive,
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
  GroupRepoLive,
  InvitationRepoLive,
  IosAppMetadataRepoLive,
  IosBundleConfigurationRepoLive,
  MemberRepoLive,
  OrganizationRepoLive,
  PolicyAttachmentRepoLive,
  PolicyRepoLive,
  OrgVaultRepoLive,
  ProjectRepoLive,
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
