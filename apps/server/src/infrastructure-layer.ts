import { Layer } from "effect";

import { AnalyticsEngineLive } from "./cloudflare/analytics-engine";
import { AppleAppStoreConnectLive } from "./cloudflare/apple-app-store-connect";
import { AssetStorageLive } from "./cloudflare/asset-storage";
import { BuildRuntimeLive } from "./cloudflare/build-runtime";
import { CredentialArtifactsLive } from "./cloudflare/credential-artifacts";
import { CryptoServiceLive } from "./cloudflare/crypto-service";
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
  BranchRepoLive,
  BuildRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  DeviceRegistrationRequestRepoLive,
  DeviceRepoLive,
  EnvVarRepoLive,
  GoogleServiceAccountKeyRepoLive,
  IosBundleConfigurationRepoLive,
  ProjectRepoLive,
  UpdateRepoLive,
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
  BranchRepo,
  BuildRepo,
  ChannelRepo,
  CompatibilityRepo,
  DeviceRegistrationRequestRepo,
  DeviceRepo,
  EnvVarRepo,
  GoogleServiceAccountKeyRepo,
  IosBundleConfigurationRepo,
  ProjectRepo,
  UpdateRepo,
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
  | BranchRepo
  | BuildRepo
  | BuildRuntime
  | ChannelRepo
  | CompatibilityRepo
  | CredentialArtifacts
  | CryptoService
  | DeviceRegistrationRequestRepo
  | DeviceRepo
  | EnvVarRepo
  | GoogleServiceAccountKeyRepo
  | IosBundleConfigurationRepo
  | ManifestCacheStorage
  | ProjectRepo
  | UpdateCoordinator
  | UpdateRepo
  | Vault;

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
  BranchRepoLive,
  BuildRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  DeviceRegistrationRequestRepoLive,
  DeviceRepoLive,
  EnvVarRepoLive,
  GoogleServiceAccountKeyRepoLive,
  IosBundleConfigurationRepoLive,
  ProjectRepoLive,
  UpdateRepoLive,
);

export const AdapterLayer = Layer.mergeAll(
  AnalyticsEngineLive,
  AppleAppStoreConnectLive,
  AssetStorageLive,
  BuildRuntimeLive,
  CredentialArtifactsLive,
  CryptoServiceLive,
  ManifestCacheStorageLive,
  UpdateCoordinatorLive,
  VaultLive.pipe(Layer.provide(CryptoServiceLive)),
);

export const ServerInfrastructureLayer = Layer.merge(
  AdapterLayer,
  RepositoryLayer.pipe(Layer.provide(AdapterLayer)),
);
