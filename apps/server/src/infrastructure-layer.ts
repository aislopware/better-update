import { Layer } from "effect";

import { AnalyticsEngineLive } from "./cloudflare/analytics-engine";
import { AppleAppStoreConnectLive } from "./cloudflare/apple-app-store-connect";
import { AssetStorageLive } from "./cloudflare/asset-storage";
import { BuildRuntimeLive } from "./cloudflare/build-runtime";
import { CredentialArtifactsLive } from "./cloudflare/credential-artifacts";
import { CryptoServiceLive } from "./cloudflare/crypto-service";
import { EmailServiceLive } from "./cloudflare/email-service";
import { ManifestCacheStorageLive } from "./cloudflare/manifest-cache-storage";
import { UpdateCoordinatorLive } from "./cloudflare/update-coordinator";
import { VaultLive } from "./cloudflare/vault";
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
  ProjectRepoLive,
  SubmissionsRepoLive,
  UpdateRepoLive,
  WebhookRepoLive,
} from "./repositories";

import type { AnalyticsEngine } from "./cloudflare/analytics-engine";
import type { AppleAppStoreConnect } from "./cloudflare/apple-app-store-connect";
import type { AssetStorage } from "./cloudflare/asset-storage";
import type { BuildRuntime } from "./cloudflare/build-runtime";
import type { CredentialArtifacts } from "./cloudflare/credential-artifacts";
import type { ManifestCacheStorage } from "./cloudflare/manifest-cache-storage";
import type { UpdateCoordinator } from "./cloudflare/update-coordinator";
import type { Vault } from "./cloudflare/vault";
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
  ProjectRepo,
  SubmissionsRepo,
  UpdateRepo,
  WebhookRepo,
} from "./repositories";

export type ServerInfrastructure =
  | AnalyticsEngine
  | AnalyticsRepo
  | AndroidApplicationIdentifierRepo
  | AndroidBuildCredentialsRepo
  | AndroidUploadKeystoreRepo
  | AppleAppStoreConnect
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
  | ProjectRepo
  | SubmissionsRepo
  | UpdateCoordinator
  | UpdateRepo
  | Vault
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
  ProjectRepoLive,
  SubmissionsRepoLive,
  UpdateRepoLive,
  WebhookRepoLive,
);

export const AdapterLayer = Layer.mergeAll(
  AnalyticsEngineLive,
  AppleAppStoreConnectLive,
  AssetStorageLive,
  BuildRuntimeLive,
  CredentialArtifactsLive,
  CryptoServiceLive,
  EmailServiceLive,
  ManifestCacheStorageLive,
  UpdateCoordinatorLive,
  VaultLive.pipe(Layer.provide(CryptoServiceLive)),
);

export const ServerInfrastructureLayer = Layer.merge(
  AdapterLayer,
  RepositoryLayer.pipe(Layer.provide(AdapterLayer)),
);
