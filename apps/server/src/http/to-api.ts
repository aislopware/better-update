import {
  AndroidApplicationIdentifier,
  AndroidBuildCredentials,
  AndroidUploadKeystore,
  AppleDistributionCertificate,
  AppleProvisioningProfile,
  ApplePushKey,
  AppleTeam,
  AscApiKey,
  AuditLog,
  Branch,
  BuildCompatibilityChannel,
  BuildWithArtifact,
  Channel,
  CompatibilityChannelInfo,
  Device,
  DeviceRegistrationRequest,
  EnvVar,
  GoogleServiceAccountKey,
  IosBundleConfiguration,
  MissingRuntimeVersionBuild,
  Project,
  Update,
} from "@better-update/api";
import { safeJsonParse } from "@better-update/safe-json";

import type {
  AndroidApplicationIdentifierModel,
  AndroidBuildCredentialsModel,
  AndroidUploadKeystoreModel,
  AppleDistributionCertificateModel,
  AppleProvisioningProfileModel,
  ApplePushKeyModel,
  AscApiKeyModel,
  AuditLogModel,
  BranchModel,
  BuildCompatibilityChannelModel,
  BuildCompatibilityMatrixModel,
  BuildWithArtifactModel,
  CompatibilityChannelInfoModel,
  ChannelModel,
  DeviceModel,
  DeviceRegistrationRequestModel,
  EnvVarModel,
  GoogleServiceAccountKeyModel,
  IosBundleConfigurationModel,
  MissingRuntimeVersionBuildModel,
  ProjectModel,
  UpdateModel,
} from "../models";
import type { AppleTeamWithCounts } from "../repositories/apple-teams";

export const toApiProject = (project: ProjectModel) =>
  new Project({
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    slug: project.slug,
    createdAt: project.createdAt,
    lastActivityAt: project.lastActivityAt,
    branchCount: project.branchCount,
    channelCount: project.channelCount,
    updateCount: project.updateCount,
  });

export const toApiBranch = (branch: BranchModel) =>
  new Branch({
    id: branch.id,
    projectId: branch.projectId,
    name: branch.name,
    createdAt: branch.createdAt,
    updateCount: branch.updateCount,
  });

export const toApiChannel = (channel: ChannelModel) =>
  new Channel({
    id: channel.id,
    projectId: channel.projectId,
    name: channel.name,
    branchId: channel.branchId,
    branchMappingJson: channel.branchMappingJson,
    cacheVersion: channel.cacheVersion,
    isPaused: channel.isPaused,
    createdAt: channel.createdAt,
  });

export const toApiUpdate = (update: UpdateModel) =>
  new Update({
    id: update.id,
    branchId: update.branchId,
    runtimeVersion: update.runtimeVersion,
    platform: update.platform,
    message: update.message,
    metadataJson: update.metadataJson,
    extraJson: update.extraJson,
    groupId: update.groupId,
    rolloutPercentage: update.rolloutPercentage,
    isRollback: update.isRollback,
    signature: update.signature,
    certificateChain: update.certificateChain,
    manifestBody: update.manifestBody,
    directiveBody: update.directiveBody,
    createdAt: update.createdAt,
  });

export const toApiEnvVar = (envVar: EnvVarModel) =>
  new EnvVar({
    id: envVar.id,
    organizationId: envVar.organizationId,
    projectId: envVar.projectId,
    scope: envVar.scope,
    key: envVar.key,
    visibility: envVar.visibility,
    value: envVar.value,
    environments: envVar.environments,
    ...(envVar.overridesGlobal ? { overridesGlobal: true } : {}),
    createdAt: envVar.createdAt,
    updatedAt: envVar.updatedAt,
  });

export const toApiBuild = (build: BuildWithArtifactModel) =>
  new BuildWithArtifact({
    id: build.id,
    projectId: build.projectId,
    platform: build.platform,
    profile: build.profile,
    distribution: build.distribution,
    runtimeVersion: build.runtimeVersion,
    appVersion: build.appVersion,
    buildNumber: build.buildNumber,
    bundleId: build.bundleId,
    gitRef: build.gitRef,
    gitCommit: build.gitCommit,
    message: build.message,
    metadataJson: build.metadataJson,
    createdAt: build.createdAt,
    artifact: build.artifact,
  });

const toApiBuildCompatibilityChannel = (channel: BuildCompatibilityChannelModel) =>
  new BuildCompatibilityChannel({
    channelId: channel.channelId,
    updateCount: channel.updateCount,
    latestUpdateId: channel.latestUpdateId,
    latestUpdateMessage: channel.latestUpdateMessage,
    latestUpdateCreatedAt: channel.latestUpdateCreatedAt,
  });

const toApiCompatibilityChannelInfo = (channel: CompatibilityChannelInfoModel) =>
  new CompatibilityChannelInfo({
    channelId: channel.channelId,
    channelName: channel.channelName,
    isPaused: channel.isPaused,
    rolloutActive: channel.rolloutActive,
  });

const toApiMissingRuntimeVersionBuild = (build: MissingRuntimeVersionBuildModel) =>
  new MissingRuntimeVersionBuild({
    channelId: build.channelId,
    channelName: build.channelName,
    platform: build.platform,
    runtimeVersion: build.runtimeVersion,
    updateCount: build.updateCount,
    latestUpdateId: build.latestUpdateId,
    latestUpdateMessage: build.latestUpdateMessage,
    latestUpdateCreatedAt: build.latestUpdateCreatedAt,
    rolloutActive: build.rolloutActive,
  });

export const toApiBuildCompatibilityMatrix = (matrix: BuildCompatibilityMatrixModel) => ({
  channels: matrix.channels.map(toApiCompatibilityChannelInfo),
  channelStatusByKey: Object.fromEntries(
    Object.entries(matrix.channelStatusByKey).map(([key, statuses]) => [
      key,
      statuses.map(toApiBuildCompatibilityChannel),
    ]),
  ),
  missingRuntimeVersions: matrix.missingRuntimeVersions.map(toApiMissingRuntimeVersionBuild),
});

export const toApiDevice = (device: DeviceModel) =>
  new Device({
    id: device.id,
    organizationId: device.organizationId,
    appleTeamId: device.appleTeamId,
    identifier: device.identifier,
    name: device.name,
    model: device.model,
    deviceClass: device.deviceClass,
    enabled: device.enabled,
    appleDevicePortalId: device.appleDevicePortalId,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  });

export const toApiDeviceRegistrationRequest = (
  model: DeviceRegistrationRequestModel,
  url: string,
) =>
  new DeviceRegistrationRequest({
    id: model.id,
    organizationId: model.organizationId,
    appleTeamId: model.appleTeamId,
    deviceNameHint: model.deviceNameHint,
    deviceClassHint: model.deviceClassHint,
    url,
    expiresAt: model.expiresAt,
    consumedAt: model.consumedAt,
    consumedDeviceId: model.consumedDeviceId,
    createdAt: model.createdAt,
  });

export const toApiAuditLog = (log: AuditLogModel) =>
  new AuditLog({
    id: log.id,
    organizationId: log.organizationId,
    actorId: log.actorId,
    actorEmail: log.actorEmail,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    metadata: log.metadata,
    source: log.source,
    createdAt: log.createdAt,
  });

export const toApiAppleTeamWithCounts = (team: AppleTeamWithCounts): AppleTeam =>
  new AppleTeam({
    id: team.id,
    organizationId: team.organizationId,
    appleTeamId: team.appleTeamId,
    appleTeamType: team.appleTeamType,
    name: team.name,
    distributionCertificateCount: team.distributionCertificateCount,
    pushKeyCount: team.pushKeyCount,
    ascApiKeyCount: team.ascApiKeyCount,
    provisioningProfileCount: team.provisioningProfileCount,
    deviceCount: team.deviceCount,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  });

export const toApiAppleDistributionCertificate = (
  model: AppleDistributionCertificateModel,
): AppleDistributionCertificate =>
  new AppleDistributionCertificate({
    id: model.id,
    organizationId: model.organizationId,
    appleTeamId: model.appleTeamId,
    serialNumber: model.serialNumber,
    developerIdIdentifier: model.developerIdIdentifier,
    validFrom: model.validFrom,
    validUntil: model.validUntil,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiApplePushKey = (model: ApplePushKeyModel): ApplePushKey =>
  new ApplePushKey({
    id: model.id,
    organizationId: model.organizationId,
    appleTeamId: model.appleTeamId,
    keyId: model.keyId,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

const parseRoles = (roles: string): readonly string[] => {
  const parsed = safeJsonParse(roles);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((value): value is string => typeof value === "string");
};

export const toApiAscApiKey = (model: AscApiKeyModel): AscApiKey =>
  new AscApiKey({
    id: model.id,
    organizationId: model.organizationId,
    appleTeamId: model.appleTeamId,
    keyId: model.keyId,
    name: model.name,
    roles: parseRoles(model.roles),
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiAppleProvisioningProfile = (
  model: AppleProvisioningProfileModel,
): AppleProvisioningProfile =>
  new AppleProvisioningProfile({
    id: model.id,
    organizationId: model.organizationId,
    appleTeamId: model.appleTeamId,
    appleDistributionCertificateId: model.appleDistributionCertificateId,
    bundleIdentifier: model.bundleIdentifier,
    distributionType: model.distributionType,
    developerPortalIdentifier: model.developerPortalIdentifier,
    profileName: model.profileName,
    validUntil: model.validUntil,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiGoogleServiceAccountKey = (
  model: GoogleServiceAccountKeyModel,
): GoogleServiceAccountKey =>
  new GoogleServiceAccountKey({
    id: model.id,
    organizationId: model.organizationId,
    clientEmail: model.clientEmail,
    privateKeyId: model.privateKeyId,
    googleProjectId: model.googleProjectId,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiIosBundleConfiguration = (
  model: IosBundleConfigurationModel,
): IosBundleConfiguration =>
  new IosBundleConfiguration({
    id: model.id,
    organizationId: model.organizationId,
    projectId: model.projectId,
    bundleIdentifier: model.bundleIdentifier,
    distributionType: model.distributionType,
    appleTeamId: model.appleTeamId,
    appleDistributionCertificateId: model.appleDistributionCertificateId,
    appleProvisioningProfileId: model.appleProvisioningProfileId,
    applePushKeyId: model.applePushKeyId,
    ascApiKeyId: model.ascApiKeyId,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiAndroidApplicationIdentifier = (
  model: AndroidApplicationIdentifierModel,
): AndroidApplicationIdentifier =>
  new AndroidApplicationIdentifier({
    id: model.id,
    organizationId: model.organizationId,
    projectId: model.projectId,
    packageName: model.packageName,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiAndroidUploadKeystore = (
  model: AndroidUploadKeystoreModel,
): AndroidUploadKeystore =>
  new AndroidUploadKeystore({
    id: model.id,
    organizationId: model.organizationId,
    keyAlias: model.keyAlias,
    md5Fingerprint: model.md5Fingerprint,
    sha1Fingerprint: model.sha1Fingerprint,
    sha256Fingerprint: model.sha256Fingerprint,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });

export const toApiAndroidBuildCredentials = (
  model: AndroidBuildCredentialsModel,
): AndroidBuildCredentials =>
  new AndroidBuildCredentials({
    id: model.id,
    organizationId: model.organizationId,
    androidApplicationIdentifierId: model.androidApplicationIdentifierId,
    androidUploadKeystoreId: model.androidUploadKeystoreId,
    googleServiceAccountKeyForSubmissionsId: model.googleServiceAccountKeyForSubmissionsId,
    googleServiceAccountKeyForFcmV1Id: model.googleServiceAccountKeyForFcmV1Id,
    name: model.name,
    isDefault: model.isDefault,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  });
