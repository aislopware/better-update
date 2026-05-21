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
  ChannelRepoLive,
  CompatibilityRepoLive,
  DeviceRegistrationRequestRepoLive,
  DeviceRepoLive,
  EnvVarRepoLive,
  GoogleServiceAccountKeyRepoLive,
  IosAppMetadataRepoLive,
  IosBundleConfigurationRepoLive,
  OrgVaultRepoLive,
  ProjectRepoLive,
  SubmissionsRepoLive,
  UpdateRepoLive,
  UserEncryptionKeyRepoLive,
  WebhookRepoLive,
} from "./repositories";

import type { AnalyticsEngine } from "./cloudflare/analytics-engine";
import type { AssetStorage } from "./cloudflare/asset-storage";
import type { BuildRuntime } from "./cloudflare/build-runtime";
import type { CredentialArtifacts } from "./cloudflare/credential-artifacts";
import type { ManifestCacheStorage } from "./cloudflare/manifest-cache-storage";
import type { UpdateCoordinator } from "./cloudflare/update-coordinator";
import type { CryptoService } from "./domain/crypto-service";
import type { EmailService } from "./domain/email-service";
import type {
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
  ChannelRepo,
  CompatibilityRepo,
  DeviceRegistrationRequestRepo,
  DeviceRepo,
  EnvVarRepo,
  GoogleServiceAccountKeyRepo,
  IosAppMetadataRepo,
  IosBundleConfigurationRepo,
  OrgVaultRepo,
  ProjectRepo,
  SubmissionsRepo,
  UpdateRepo,
  UserEncryptionKeyRepo,
  WebhookRepo,
} from "./repositories";

export type ServerInfrastructure =
  | AnalyticsEngine
  | AnalyticsRepo
  | AndroidApplicationIdentifierRepo
  | AndroidBuildCredentialsRepo
  | AndroidUploadKeystoreRepo
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
  | ChannelRepo
  | CompatibilityRepo
  | CredentialArtifacts
  | CryptoService
  | DeviceRegistrationRequestRepo
  | DeviceRepo
  | EmailService
  | EnvVarRepo
  | GoogleServiceAccountKeyRepo
  | IosAppMetadataRepo
  | IosBundleConfigurationRepo
  | ManifestCacheStorage
  | OrgVaultRepo
  | ProjectRepo
  | SubmissionsRepo
  | UpdateCoordinator
  | UpdateRepo
  | UserEncryptionKeyRepo
  | WebhookRepo;

export const RepositoryLayer = Layer.mergeAll(
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
  ChannelRepoLive,
  CompatibilityRepoLive,
  DeviceRegistrationRequestRepoLive,
  DeviceRepoLive,
  EnvVarRepoLive,
  GoogleServiceAccountKeyRepoLive,
  IosAppMetadataRepoLive,
  IosBundleConfigurationRepoLive,
  OrgVaultRepoLive,
  ProjectRepoLive,
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
