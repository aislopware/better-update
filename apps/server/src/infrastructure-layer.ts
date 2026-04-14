import { Layer } from "effect";

import { AnalyticsEngineLive } from "./cloudflare/analytics-engine";
import { AssetStorageLive } from "./cloudflare/asset-storage";
import { BuildRuntimeLive } from "./cloudflare/build-runtime";
import { UpdateCoordinatorLive } from "./cloudflare/update-coordinator";
import { VaultLive } from "./cloudflare/vault";
import {
  AnalyticsRepoLive,
  AssetRepoLive,
  AuditLogRepoLive,
  BranchRepoLive,
  BuildRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  CredentialRepoLive,
  EnvVarRepoLive,
  PatchRepoLive,
  ProjectRepoLive,
  UpdateRepoLive,
} from "./repositories";

import type { AnalyticsEngine } from "./cloudflare/analytics-engine";
import type { AssetStorage } from "./cloudflare/asset-storage";
import type { BuildRuntime } from "./cloudflare/build-runtime";
import type { UpdateCoordinator } from "./cloudflare/update-coordinator";
import type { Vault } from "./cloudflare/vault";
import type {
  AnalyticsRepo,
  AssetRepo,
  AuditLogRepo,
  BranchRepo,
  BuildRepo,
  ChannelRepo,
  CompatibilityRepo,
  CredentialRepo,
  EnvVarRepo,
  PatchRepo,
  ProjectRepo,
  UpdateRepo,
} from "./repositories";

export type ServerInfrastructure =
  | AnalyticsEngine
  | AnalyticsRepo
  | AssetRepo
  | AssetStorage
  | AuditLogRepo
  | BranchRepo
  | BuildRepo
  | BuildRuntime
  | ChannelRepo
  | CompatibilityRepo
  | CredentialRepo
  | EnvVarRepo
  | PatchRepo
  | ProjectRepo
  | UpdateCoordinator
  | UpdateRepo
  | Vault;

export const RepositoryLayer = Layer.mergeAll(
  AnalyticsRepoLive,
  AssetRepoLive,
  AuditLogRepoLive,
  BranchRepoLive,
  BuildRepoLive,
  ChannelRepoLive,
  CompatibilityRepoLive,
  CredentialRepoLive,
  EnvVarRepoLive,
  PatchRepoLive,
  ProjectRepoLive,
  UpdateRepoLive,
);

export const AdapterLayer = Layer.mergeAll(
  AnalyticsEngineLive,
  AssetStorageLive,
  BuildRuntimeLive,
  UpdateCoordinatorLive,
  VaultLive,
);

export const ServerInfrastructureLayer = Layer.merge(
  AdapterLayer,
  RepositoryLayer.pipe(Layer.provide(AdapterLayer)),
);
