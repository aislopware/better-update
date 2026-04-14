// Root API
export { ManagementApi } from "./api";
export { ProtocolApi } from "./protocol-api";
export { safeJsonParse } from "./json";

// Auth
export { AuthContext } from "./auth/context";
export { Authentication } from "./auth/middleware";
export { Forbidden, OrgRequired, Unauthorized } from "./auth/errors";
export { NotFound } from "./auth/ownership";

export type {
  Action,
  AuthContextShape,
  EffectivePermissions,
  Resource,
  Role,
} from "./auth/context";

// Domain schemas
export { AuditLog, AuditLogResourceType, AuditLogSource } from "./domain/audit-log";
export { DateTimeString, Id, PaginationParams, Platform } from "./domain/common";
export { BadRequest, Conflict, NotAcceptable } from "./domain/errors";
export {
  CreateProjectBody,
  DeleteProjectResult,
  Project,
  UpdateProjectBody,
} from "./domain/project";
export { Branch, CreateBranchBody, DeleteBranchResult, UpdateBranchBody } from "./domain/branch";
export {
  Channel,
  CreateBranchRolloutBody,
  CreateChannelBody,
  DeleteChannelResult,
  UpdateChannelBody,
} from "./domain/channel";
export {
  AssetRef,
  CreateUpdateBody,
  DeleteUpdateResult,
  RepublishBody,
  RepublishResult,
  Update,
} from "./domain/update";
export { Asset, AssetUploadBody, AssetUploadResult } from "./domain/asset";
export {
  Credential,
  CreateCredentialBody,
  CredentialDistribution,
  CredentialDownload,
  CredentialType,
  DeleteCredentialResult,
} from "./domain/credential";
export {
  BulkImportEnvVarsBody,
  BulkImportResult,
  CreateEnvVarBody,
  DeleteEnvVarResult,
  EnvVar,
  EnvVarExportItem,
  EnvVarExportResult,
  EnvVarVisibility,
  UpdateEnvVarBody,
} from "./domain/env-var";
export {
  ArtifactFormat,
  Build,
  BuildCompatibilityChannel,
  BuildCompatibilityMatrixResult,
  BuildCompatibilityRow,
  BuildArtifact,
  BuildWithArtifact,
  CompleteBuildBody,
  CreateBuildBody,
  DeleteBuildResult,
  Distribution,
  InstallLinkResult,
  MissingRuntimeVersionBuild,
  ReserveBuildResult,
} from "./domain/build";
export {
  AdoptionParams,
  AdoptionResult,
  ChannelAnalyticsParams,
  ChannelAnalyticsResult,
  PeriodLiteral,
  PlatformParams,
  PlatformResult,
  UpdateAnalyticsParams,
  UpdateAnalyticsResult,
} from "./domain/analytics";

// Groups
export { AuditLogsGroup } from "./groups/audit-logs";
export { AnalyticsGroup } from "./groups/analytics";
export { AssetsGroup } from "./groups/assets";
export { BranchesGroup } from "./groups/branches";
export { BuildsGroup } from "./groups/builds";
export { CredentialsGroup } from "./groups/credentials";
export { EnvVarsGroup } from "./groups/env-vars";
export { ChannelsGroup } from "./groups/channels";
export { ManifestGroup } from "./groups/manifest";
export { ProjectsGroup } from "./groups/projects";
export { UpdatesGroup } from "./groups/updates";
