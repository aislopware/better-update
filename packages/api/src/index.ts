// Root API
export { ManagementApi } from "./api";
export { ProtocolApi } from "./protocol-api";

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
export { DateTimeString, Id, PaginationParams, Platform } from "./domain/common";
export { BadRequest, Conflict, NotAcceptable } from "./domain/errors";
export { CreateProjectBody, Project } from "./domain/project";
export { Branch, CreateBranchBody, UpdateBranchBody } from "./domain/branch";
export {
  Channel,
  CreateBranchRolloutBody,
  CreateChannelBody,
  UpdateChannelBody,
} from "./domain/channel";
export {
  AssetRef,
  CreateUpdateBody,
  DeleteUpdateResult,
  RepublishBody,
  Update,
} from "./domain/update";
export { Asset, AssetUploadBody, AssetUploadResult } from "./domain/asset";
export {
  AdoptionParams,
  AdoptionResult,
  ChannelAnalyticsParams,
  ChannelAnalyticsResult,
  PlatformParams,
  PlatformResult,
  UpdateAnalyticsParams,
  UpdateAnalyticsResult,
} from "./domain/analytics";

// Groups
export { AnalyticsGroup } from "./groups/analytics";
export { AssetsGroup } from "./groups/assets";
export { BranchesGroup } from "./groups/branches";
export { ChannelsGroup } from "./groups/channels";
export { ManifestGroup } from "./groups/manifest";
export { ProjectsGroup } from "./groups/projects";
export { UpdatesGroup } from "./groups/updates";
