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

export type CredentialType =
  | "distribution-certificate"
  | "provisioning-profile"
  | "push-key"
  | "keystore"
  | "play-service-account";

export type CredentialDistribution =
  | "ad-hoc"
  | "app-store"
  | "development"
  | "enterprise"
  | "play-store"
  | "direct";

export type EnvVarVisibility = "plaintext" | "sensitive" | "secret";

export type AuditLogResourceType =
  | "project"
  | "branch"
  | "channel"
  | "update"
  | "build"
  | "credential"
  | "envVar";

export type AuditLogSource = "session" | "api-key";
export type AnalyticsPeriod = "1d" | "7d" | "30d" | "90d";

export type Role = "owner" | "admin" | "developer" | "viewer";

export type Resource =
  | "organization"
  | "member"
  | "invitation"
  | "project"
  | "channel"
  | "branch"
  | "update"
  | "rollout"
  | "billing"
  | "apiKey"
  | "build"
  | "credential"
  | "envVar"
  | "auditLog";

export type Action = "read" | "create" | "update" | "delete" | "cancel" | "download";

export type EffectivePermissions = Partial<Record<Resource, readonly Action[]>>;

export interface CurrentActor {
  readonly userId: string | null;
  readonly organizationId: string;
  readonly role: Role | null;
  readonly effectivePermissions: EffectivePermissions;
  readonly source: AuditLogSource;
  readonly actorEmail: string;
}

export interface ProjectModel {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly scopeKey: string;
  readonly createdAt: string;
}

export interface BranchModel {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly createdAt: string;
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

export interface CredentialModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly platform: Platform;
  readonly type: CredentialType;
  readonly name: string;
  readonly distribution: CredentialDistribution | null;
  readonly isActive: boolean;
  readonly metadata: string;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface EnvVarModel {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly environment: string;
  readonly key: string;
  readonly visibility: EnvVarVisibility;
  readonly value: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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
  readonly message: string | null;
  readonly metadataJson: string;
  readonly createdAt: string;
}

export interface BuildWithArtifactModel extends BuildModel {
  readonly artifact: BuildArtifactModel | null;
}

export interface BuildCompatibilityChannelModel {
  readonly channelId: string;
  readonly channelName: string;
  readonly updateCount: number;
  readonly latestUpdateId: string | null;
  readonly latestUpdateMessage: string | null;
  readonly latestUpdateCreatedAt: string | null;
  readonly isPaused: boolean;
  readonly rolloutActive: boolean;
}

export interface BuildCompatibilityRowModel extends BuildWithArtifactModel {
  readonly channels: readonly BuildCompatibilityChannelModel[];
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
  readonly rows: readonly BuildCompatibilityRowModel[];
  readonly missingRuntimeVersions: readonly MissingRuntimeVersionBuildModel[];
}

export interface AuditLogModel {
  readonly id: string;
  readonly organizationId: string;
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
