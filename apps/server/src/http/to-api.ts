import {
  AuditLog,
  BadRequest as ApiBadRequest,
  Branch,
  Channel,
  BuildCompatibilityChannel,
  BuildCompatibilityRow,
  BuildWithArtifact,
  Conflict as ApiConflict,
  Credential,
  EnvVar,
  Forbidden as ApiForbidden,
  MissingRuntimeVersionBuild,
  NotAcceptable as ApiNotAcceptable,
  NotFound as ApiNotFound,
  OrgRequired as ApiOrgRequired,
  Project,
  Unauthorized as ApiUnauthorized,
  Update,
} from "@better-update/api";

import type {
  AppError,
  BadRequest,
  Conflict,
  Forbidden,
  NotAcceptable,
  NotFound,
  OrgRequired,
  Unauthorized,
} from "../errors";
import type {
  AuditLogModel,
  BranchModel,
  BuildCompatibilityChannelModel,
  BuildCompatibilityMatrixModel,
  BuildCompatibilityRowModel,
  BuildWithArtifactModel,
  ChannelModel,
  CredentialModel,
  EnvVarModel,
  MissingRuntimeVersionBuildModel,
  ProjectModel,
  UpdateModel,
} from "../models";

export type ApiError =
  | ApiBadRequest
  | ApiConflict
  | ApiForbidden
  | ApiNotAcceptable
  | ApiNotFound
  | ApiOrgRequired
  | ApiUnauthorized;

export const toApiProject = (project: ProjectModel) =>
  new Project({
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    scopeKey: project.scopeKey,
    createdAt: project.createdAt,
  });

export const toApiBranch = (branch: BranchModel) =>
  new Branch({
    id: branch.id,
    projectId: branch.projectId,
    name: branch.name,
    createdAt: branch.createdAt,
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

export const toApiCredential = (credential: CredentialModel) =>
  new Credential({
    id: credential.id,
    organizationId: credential.organizationId,
    projectId: credential.projectId,
    platform: credential.platform,
    type: credential.type,
    name: credential.name,
    distribution: credential.distribution,
    isActive: credential.isActive,
    metadata: credential.metadata,
    expiresAt: credential.expiresAt,
    createdAt: credential.createdAt,
  });

export const toApiEnvVar = (envVar: EnvVarModel) =>
  new EnvVar({
    id: envVar.id,
    organizationId: envVar.organizationId,
    projectId: envVar.projectId,
    environment: envVar.environment,
    key: envVar.key,
    visibility: envVar.visibility,
    value: envVar.value,
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
    channelName: channel.channelName,
    updateCount: channel.updateCount,
    latestUpdateId: channel.latestUpdateId,
    latestUpdateMessage: channel.latestUpdateMessage,
    latestUpdateCreatedAt: channel.latestUpdateCreatedAt,
    isPaused: channel.isPaused,
    rolloutActive: channel.rolloutActive,
  });

const toApiBuildCompatibilityRow = (row: BuildCompatibilityRowModel) =>
  new BuildCompatibilityRow({
    id: row.id,
    projectId: row.projectId,
    platform: row.platform,
    profile: row.profile,
    distribution: row.distribution,
    runtimeVersion: row.runtimeVersion,
    appVersion: row.appVersion,
    buildNumber: row.buildNumber,
    bundleId: row.bundleId,
    gitRef: row.gitRef,
    gitCommit: row.gitCommit,
    message: row.message,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
    artifact: row.artifact,
    channels: row.channels.map(toApiBuildCompatibilityChannel),
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
  rows: matrix.rows.map(toApiBuildCompatibilityRow),
  missingRuntimeVersions: matrix.missingRuntimeVersions.map(toApiMissingRuntimeVersionBuild),
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

export function toApiError(error: AppError): ApiError;
export function toApiError(error: BadRequest): ApiBadRequest;
export function toApiError(error: Conflict): ApiConflict;
export function toApiError(error: Forbidden): ApiForbidden;
export function toApiError(error: NotAcceptable): ApiNotAcceptable;
export function toApiError(error: NotFound): ApiNotFound;
export function toApiError(error: OrgRequired): ApiOrgRequired;
export function toApiError(error: Unauthorized): ApiUnauthorized;
export function toApiError(error: AppError): ApiError {
  switch (error._tag) {
    case "BadRequest": {
      return new ApiBadRequest({ message: error.message });
    }
    case "Conflict": {
      return new ApiConflict({ message: error.message });
    }
    case "Forbidden": {
      return new ApiForbidden({ message: error.message });
    }
    case "NotAcceptable": {
      return new ApiNotAcceptable({ message: error.message });
    }
    case "NotFound": {
      return new ApiNotFound({ message: error.message });
    }
    case "OrgRequired": {
      return new ApiOrgRequired({ message: error.message });
    }
    case "Unauthorized": {
      return new ApiUnauthorized({ message: error.message });
    }
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}
