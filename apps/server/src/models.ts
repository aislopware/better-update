import type { EffectivePermissions, Role } from "./authz-models";

export type Platform = "ios" | "android";

export type Distribution =
  | "app-store"
  | "ad-hoc"
  | "development"
  | "enterprise"
  | "simulator"
  | "play-store"
  | "direct";

export type ArtifactFormat = "ipa" | "apk" | "aab" | "tar.gz";

export type DistributionType = "APP_STORE" | "AD_HOC" | "ENTERPRISE" | "DEVELOPMENT";

export type AppleTeamType = "IN_HOUSE" | "COMPANY_ORGANIZATION" | "INDIVIDUAL";

export type EnvVarVisibility = "plaintext" | "sensitive";

export type EnvVarScope = "project" | "global";

export type EnvVarEnvironment = "development" | "preview" | "production";

export type AuditLogResourceType =
  | "project"
  | "branch"
  | "channel"
  | "update"
  | "build"
  | "appleCredential"
  | "androidCredential"
  | "iosBundleConfiguration"
  | "envVar"
  | "device"
  | "webhook"
  | "iosAppMetadata"
  | "submission"
  | "vaultAccess";

export type DeviceClass = "IPHONE" | "IPAD" | "MAC" | "UNKNOWN";

export type AuditLogSource = "session" | "api-key";
export type AnalyticsPeriod = "1d" | "7d" | "30d" | "90d";

// Permission scalars (Role/BuiltinRole/Resource/Action/EffectivePermissions) live
// in ./authz-models; the import above binds Role/EffectivePermissions in-file (used by
// CurrentActor below), and the re-export below keeps downstream `./models` consumers unchanged.
export type { Action, BuiltinRole, EffectivePermissions, Resource, Role } from "./authz-models";

export type EncryptionKeyKind = "device" | "recovery" | "machine";

export interface CurrentActor {
  readonly userId: string | null;
  readonly organizationId: string;
  // Active-org `member.id`, or `null` for API-key principals (no scoped grants).
  readonly memberId: string | null;
  readonly role: Role | null;
  readonly effectivePermissions: EffectivePermissions;
  readonly source: AuditLogSource;
  readonly transport: "bearer" | "cookie";
  readonly actorEmail: string;
  readonly isSuperadmin: boolean;
}

export interface ProjectModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly branchCount: number;
  readonly channelCount: number;
  readonly updateCount: number;
}

export interface BranchModel {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updateCount: number;
}

export interface ChannelModel {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly branchId: string;
  readonly branchMappingJson: string | null;
  readonly cacheVersion: number;
  readonly isPaused: boolean;
  readonly createdAt: string;
}

export interface UpdateAssetRefModel {
  readonly hash: string;
  readonly key: string;
  readonly isLaunch: boolean;
  readonly contentChecksum?: string | undefined;
}

export interface UpdateModel {
  readonly id: string;
  readonly branchId: string;
  readonly runtimeVersion: string;
  readonly platform: Platform;
  readonly message: string;
  readonly metadataJson: string;
  readonly extraJson: string | null;
  readonly groupId: string;
  readonly rolloutPercentage: number;
  readonly isRollback: boolean;
  readonly signature: string | null;
  readonly certificateChain: string | null;
  readonly manifestBody: string | null;
  readonly directiveBody: string | null;
  readonly fingerprintHash: string | null;
  readonly gitCommit: string | null;
  readonly gitDirty: boolean;
  readonly totalAssetSize: number;
  readonly createdAt: string;
}

export interface AssetModel {
  readonly hash: string;
  readonly contentType: string;
  readonly fileExt: string;
  readonly byteSize: number;
  readonly r2Key: string;
  readonly contentChecksum: string;
  readonly createdAt: string;
}

export interface DeviceModel {
  readonly id: string;
  readonly organizationId: string;
  readonly appleTeamId: string | null;
  readonly identifier: string;
  readonly name: string;
  readonly model: string | null;
  readonly deviceClass: DeviceClass;
  readonly enabled: boolean;
  readonly appleDevicePortalId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeviceRegistrationRequestModel {
  readonly id: string;
  readonly organizationId: string;
  readonly appleTeamId: string | null;
  readonly createdByUserId: string;
  readonly deviceNameHint: string | null;
  readonly deviceClassHint: DeviceClass | null;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly consumedDeviceId: string | null;
  readonly createdAt: string;
}

export interface AppleTeamModel {
  readonly id: string;
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly appleTeamType: AppleTeamType;
  readonly name: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AppleDistributionCertificateModel {
  readonly id: string;
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly serialNumber: string;
  readonly developerIdIdentifier: string | null;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly r2Key: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApplePushKeyModel {
  readonly id: string;
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly keyId: string;
  readonly r2Key: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserEncryptionKeyModel {
  readonly id: string;
  readonly userId: string | null;
  readonly organizationId: string | null;
  readonly kind: EncryptionKeyKind;
  readonly publicKey: string;
  readonly label: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface OrgVaultModel {
  readonly organizationId: string;
  readonly vaultVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrgVaultKeyWrapModel {
  readonly organizationId: string;
  readonly vaultVersion: number;
  readonly userEncryptionKeyId: string;
  readonly wrappedKey: string;
  readonly createdAt: string;
}

/**
 * The secret kinds whose DEK is wrapped under the org vault key — the rows a
 * rotation must re-wrap. Besides the five signing credentials, each environment
 * variable value revision is its own E2E-encrypted secret bound to the vault.
 */
export type EncryptedCredentialType =
  | "appleDistributionCertificate"
  | "applePushKey"
  | "ascApiKey"
  | "googleServiceAccountKey"
  | "androidUploadKeystore"
  | "envVarValue";

/** A credential row's identity for rotation coverage (type + id, version-agnostic). */
export interface CredentialRef {
  readonly credentialType: EncryptedCredentialType;
  readonly id: string;
}

/** A credential row's currently-wrapped DEK — the source the client re-wraps in a rotation. */
export interface CredentialDekRefModel {
  readonly credentialType: EncryptedCredentialType;
  readonly credentialId: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
}

export interface AscApiKeyModel {
  readonly id: string;
  readonly organizationId: string;
  readonly appleTeamId: string | null;
  readonly keyId: string;
  readonly issuerId: string;
  readonly name: string;
  readonly roles: string;
  readonly r2Key: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AppleProvisioningProfileModel {
  readonly id: string;
  readonly organizationId: string;
  readonly appleTeamId: string;
  readonly appleDistributionCertificateId: string | null;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly developerPortalIdentifier: string | null;
  readonly profileName: string | null;
  readonly validUntil: string | null;
  readonly r2Key: string;
  readonly isManaged: boolean;
  readonly deviceRosterHash: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GoogleServiceAccountKeyModel {
  readonly id: string;
  readonly organizationId: string;
  readonly clientEmail: string;
  readonly privateKeyId: string;
  readonly googleProjectId: string;
  readonly r2Key: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IosBundleConfigurationModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly appleTeamId: string;
  readonly appleDistributionCertificateId: string | null;
  readonly appleProvisioningProfileId: string | null;
  readonly applePushKeyId: string | null;
  readonly ascApiKeyId: string | null;
  readonly targetName: string | null;
  readonly parentBundleIdentifier: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AndroidApplicationIdentifierModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly packageName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AndroidUploadKeystoreModel {
  readonly id: string;
  readonly organizationId: string;
  readonly keyAlias: string;
  readonly r2Key: string;
  readonly wrappedDek: string;
  readonly vaultVersion: number;
  readonly md5Fingerprint: string | null;
  readonly sha1Fingerprint: string | null;
  readonly sha256Fingerprint: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AndroidBuildCredentialsModel {
  readonly id: string;
  readonly organizationId: string;
  readonly androidApplicationIdentifierId: string;
  readonly androidUploadKeystoreId: string | null;
  readonly googleServiceAccountKeyForSubmissionsId: string | null;
  readonly googleServiceAccountKeyForFcmV1Id: string | null;
  readonly name: string;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Env var metadata + revision models live in ./env-var-models (kept out of this
// file to stay under the max-lines budget), mirroring ./submission-models.

export interface BuildArtifactModel {
  readonly r2Key: string;
  readonly format: ArtifactFormat;
  readonly contentType: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface BuildModel {
  readonly id: string;
  readonly projectId: string;
  readonly platform: Platform;
  readonly profile: string;
  readonly distribution: Distribution;
  readonly runtimeVersion: string | null;
  readonly appVersion: string | null;
  readonly buildNumber: string | null;
  readonly bundleId: string | null;
  readonly gitRef: string | null;
  readonly gitCommit: string | null;
  readonly gitDirty: boolean;
  readonly message: string | null;
  readonly metadataJson: string;
  readonly fingerprintHash: string | null;
  readonly createdAt: string;
}

export interface BuildWithArtifactModel extends BuildModel {
  readonly artifact: BuildArtifactModel | null;
}

export interface BuildCompatibilityChannelModel {
  readonly channelId: string;
  readonly updateCount: number;
  readonly latestUpdateId: string | null;
  readonly latestUpdateMessage: string | null;
  readonly latestUpdateCreatedAt: string | null;
}

export interface CompatibilityChannelInfoModel {
  readonly channelId: string;
  readonly channelName: string;
  readonly isPaused: boolean;
  readonly rolloutActive: boolean;
}

export interface MissingRuntimeVersionBuildModel {
  readonly channelId: string;
  readonly channelName: string;
  readonly platform: Platform;
  readonly runtimeVersion: string;
  readonly updateCount: number;
  readonly latestUpdateId: string;
  readonly latestUpdateMessage: string;
  readonly latestUpdateCreatedAt: string;
  readonly rolloutActive: boolean;
}

export interface BuildCompatibilityMatrixModel {
  readonly channels: readonly CompatibilityChannelInfoModel[];
  readonly channelStatusByKey: Readonly<Record<string, readonly BuildCompatibilityChannelModel[]>>;
  readonly missingRuntimeVersions: readonly MissingRuntimeVersionBuildModel[];
}

export interface AuditLogModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly actorId: string | null;
  readonly actorEmail: string;
  readonly action: string;
  readonly resourceType: AuditLogResourceType;
  readonly resourceId: string | null;
  readonly metadata: string | null;
  readonly source: AuditLogSource;
  readonly createdAt: string;
}

export interface UpdateAdoptionEntryModel {
  readonly updateId: string;
  readonly devices: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export interface UpdateAdoptionResultModel {
  readonly updates: readonly UpdateAdoptionEntryModel[];
}

export interface AnalyticsResponseTypeBreakdownModel {
  readonly manifest: number;
  readonly directive: number;
  readonly noUpdate: number;
}

export interface AnalyticsTimeSeriesEntryModel {
  readonly timestamp: string;
  readonly requests: number;
}

export interface UpdateAnalyticsModel {
  readonly updateId: string;
  readonly totalRequests: number;
  readonly uniqueDevices: number;
  readonly byResponseType: AnalyticsResponseTypeBreakdownModel;
  readonly timeSeries: readonly AnalyticsTimeSeriesEntryModel[];
}

export interface ChannelAnalyticsModel {
  readonly channel: string;
  readonly totalRequests: number;
  readonly uniqueDevices: number;
  readonly responseTypeDistribution: AnalyticsResponseTypeBreakdownModel;
}

export interface PlatformAnalyticsEntryModel {
  readonly platform: string;
  readonly requests: number;
  readonly devices: number;
}

export interface PlatformAnalyticsResultModel {
  readonly platforms: readonly PlatformAnalyticsEntryModel[];
}
