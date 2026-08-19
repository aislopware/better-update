import { Layer } from "effect";

import { AnalyticsEngineLive } from "./cloudflare/analytics-engine";
import { AssetStorageLive } from "./cloudflare/asset-storage";
import { BuildRuntimeLive } from "./cloudflare/build-runtime";
import { CredentialArtifactsLive } from "./cloudflare/credential-artifacts";
import { CryptoServiceLive } from "./cloudflare/crypto-service";
import { EmailServiceLive } from "./cloudflare/email-service";
import { ManifestCacheStorageLive } from "./cloudflare/manifest-cache-storage";
import { UpdateCoordinatorLive } from "./cloudflare/update-coordinator";
import { WorkersCacheLive } from "./cloudflare/workers-cache";
import {
  AccountKeyRepoLive,
  AdminUsersRepoLive,
  ActivityRepoLive,
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
  BuildStorageRepoLive,
  BundleRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  DebugArtifactRepoLive,
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

/**
 * Every service the server's imperative shell can provide. Derived from the
 * layer rather than hand-listed so the two can never drift — the union is what
 * `ServerInfrastructureLayer` actually builds.
 */
export type ServerInfrastructure = Layer.Success<typeof ServerInfrastructureLayer>;

export const RepositoryLayer = Layer.mergeAll(
  AccountKeyRepoLive,
  AdminUsersRepoLive,
  ActivityRepoLive,
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
  BuildStorageRepoLive,
  BundleRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  DebugArtifactRepoLive,
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
  WorkersCacheLive,
);

export const ServerInfrastructureLayer = Layer.merge(
  AdapterLayer,
  RepositoryLayer.pipe(Layer.provide(AdapterLayer)),
);
