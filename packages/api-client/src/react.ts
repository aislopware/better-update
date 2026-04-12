import {
  AssetUploadBody,
  Branch,
  BulkImportEnvVarsBody,
  CompleteBuildBody,
  CreateBranchBody,
  CreateBranchRolloutBody,
  CreateBuildBody,
  CreateChannelBody,
  CreateCredentialBody,
  CreateEnvVarBody,
  CreateProjectBody,
  CreateUpdateBody,
  PeriodLiteral,
  Project,
  RepublishBody,
  UpdateBranchBody,
  UpdateChannelBody,
  UpdateEnvVarBody,
  UpdateProjectBody,
} from "@better-update/api";
import { queryOptions } from "@tanstack/react-query";

type AnalyticsPeriod = typeof PeriodLiteral.Type;

import { runApi } from "./index";

// ---------------------------------------------------------------------------
// Type aliases
// ---------------------------------------------------------------------------

export type ProjectItem = typeof Project.Type;
export type ProjectDetail = typeof Project.Type;
export type BranchItem = typeof Branch.Type;

// ---------------------------------------------------------------------------
// Query options factories
// ---------------------------------------------------------------------------

export const projectsQueryOptions = (orgId: string, page?: number) =>
  queryOptions({
    queryKey: ["org", orgId, "projects", ...(page != null ? [page] : [])],
    queryFn: () => runApi((api) => api.projects.list({ urlParams: { page } })),
    staleTime: 30_000,
  });

export const projectQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["project", projectId],
    queryFn: () => runApi((api) => api.projects.get({ path: { id: projectId } })),
    staleTime: 30_000,
  });

export const branchesQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "projects", projectId, "branches"],
    queryFn: () => runApi((api) => api.branches.list({ urlParams: { projectId, limit: 1000 } })),
    staleTime: 30_000,
  });

export const channelsQueryOptions = (orgId: string, projectId: string, limit?: number) =>
  queryOptions({
    queryKey: ["org", orgId, "projects", projectId, "channels", ...(limit != null ? [limit] : [])],
    queryFn: () => runApi((api) => api.channels.list({ urlParams: { projectId, limit } })),
    staleTime: 30_000,
  });

export const updatesQueryOptions = (
  orgId: string,
  projectId: string,
  branchId?: string,
  limit?: number,
) =>
  queryOptions({
    queryKey: [
      "org",
      orgId,
      "projects",
      projectId,
      "updates",
      ...(branchId ? [branchId] : []),
      ...(limit != null ? [limit] : []),
    ],
    queryFn: () => runApi((api) => api.updates.list({ urlParams: { projectId, branchId, limit } })),
    staleTime: 30_000,
  });

export const adoptionQueryOptions = (projectId: string, period?: AnalyticsPeriod) =>
  queryOptions({
    queryKey: ["project", projectId, "analytics", "adoption", ...(period ? [period] : [])],
    queryFn: () => runApi((api) => api.analytics.adoption({ urlParams: { projectId, period } })),
    staleTime: 60_000,
  });

export const updateAnalyticsQueryOptions = (
  projectId: string,
  updateId: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: ["project", projectId, "analytics", "updates", updateId, ...(period ? [period] : [])],
    queryFn: () =>
      runApi((api) => api.analytics.updates({ urlParams: { projectId, updateId, period } })),
    staleTime: 60_000,
  });

export const channelAnalyticsQueryOptions = (
  projectId: string,
  channel: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: ["project", projectId, "analytics", "channels", channel, ...(period ? [period] : [])],
    queryFn: () =>
      runApi((api) => api.analytics.channels({ urlParams: { projectId, channel, period } })),
    staleTime: 60_000,
  });

export const platformAnalyticsQueryOptions = (projectId: string, period?: AnalyticsPeriod) =>
  queryOptions({
    queryKey: ["project", projectId, "analytics", "platforms", ...(period ? [period] : [])],
    queryFn: () => runApi((api) => api.analytics.platforms({ urlParams: { projectId, period } })),
    staleTime: 60_000,
  });

// ---------------------------------------------------------------------------
// Mutation functions
// ---------------------------------------------------------------------------

// Projects
export const createProject = (body: typeof CreateProjectBody.Type) =>
  runApi((api) => api.projects.create({ payload: body }));

export const renameProject = (id: string, body: typeof UpdateProjectBody.Type) =>
  runApi((api) => api.projects.rename({ path: { id }, payload: body }));

export const deleteProject = (id: string) => runApi((api) => api.projects.delete({ path: { id } }));

// Branches
export const createBranch = (body: typeof CreateBranchBody.Type) =>
  runApi((api) => api.branches.create({ payload: body }));

export const renameBranch = (id: string, body: typeof UpdateBranchBody.Type) =>
  runApi((api) => api.branches.rename({ path: { id }, payload: body }));

export const deleteBranch = (id: string) => runApi((api) => api.branches.delete({ path: { id } }));

// Channels
export const createChannel = (body: typeof CreateChannelBody.Type) =>
  runApi((api) => api.channels.create({ payload: body }));

export const updateChannel = (id: string, body: typeof UpdateChannelBody.Type) =>
  runApi((api) => api.channels.update({ path: { id }, payload: body }));

export const pauseChannel = (id: string) => runApi((api) => api.channels.pause({ path: { id } }));

export const resumeChannel = (id: string) => runApi((api) => api.channels.resume({ path: { id } }));

export const deleteChannel = (id: string) => runApi((api) => api.channels.delete({ path: { id } }));

export const createBranchRollout = (channelId: string, body: typeof CreateBranchRolloutBody.Type) =>
  runApi((api) => api.channels.createBranchRollout({ path: { id: channelId }, payload: body }));

export const updateBranchRollout = (channelId: string, body: { percentage: number }) =>
  runApi((api) => api.channels.updateBranchRollout({ path: { id: channelId }, payload: body }));

export const completeBranchRollout = (channelId: string) =>
  runApi((api) => api.channels.completeBranchRollout({ path: { id: channelId } }));

export const revertBranchRollout = (channelId: string) =>
  runApi((api) => api.channels.revertBranchRollout({ path: { id: channelId } }));

// Updates
export const createUpdate = (body: typeof CreateUpdateBody.Type) =>
  runApi((api) => api.updates.create({ payload: body }));

export const deleteUpdateGroup = (groupId: string) =>
  runApi((api) => api.updates.deleteGroup({ path: { groupId } }));

export const republishUpdate = (body: typeof RepublishBody.Type) =>
  runApi((api) => api.updates.republish({ payload: body }));

export const editUpdateRollout = (id: string, body: { percentage: number }) =>
  runApi((api) => api.updates.editRollout({ path: { id }, payload: body }));

export const completeUpdateRollout = (id: string) =>
  runApi((api) => api.updates.completeRollout({ path: { id } }));

export const revertUpdateRollout = (id: string) =>
  runApi((api) => api.updates.revertRollout({ path: { id } }));

// Assets
export const uploadAssets = (body: typeof AssetUploadBody.Type) =>
  runApi((api) => api.assets.upload({ payload: body }));

// ---------------------------------------------------------------------------
// Builds — Query options
// ---------------------------------------------------------------------------

export const buildsQueryOptions = (
  orgId: string,
  projectId: string,
  filters?: { platform?: "ios" | "android"; profile?: string; runtimeVersion?: string },
  page?: number,
) =>
  queryOptions({
    queryKey: [
      "org",
      orgId,
      "projects",
      projectId,
      "builds",
      {
        platform: filters?.platform,
        profile: filters?.profile,
        runtimeVersion: filters?.runtimeVersion,
        page,
      },
    ],
    queryFn: () =>
      runApi((api) =>
        api.builds.list({
          urlParams: {
            projectId,
            platform: filters?.platform,
            profile: filters?.profile,
            runtimeVersion: filters?.runtimeVersion,
            page,
          },
        }),
      ),
    staleTime: 30_000,
  });

export const buildQueryOptions = (buildId: string) =>
  queryOptions({
    queryKey: ["build", buildId],
    queryFn: () => runApi((api) => api.builds.get({ path: { id: buildId } })),
    staleTime: 30_000,
  });

// Builds — Mutations
export const reserveBuild = (body: typeof CreateBuildBody.Type) =>
  runApi((api) => api.builds.reserve({ payload: body }));

export const completeBuild = (id: string, body: typeof CompleteBuildBody.Type) =>
  runApi((api) => api.builds.complete({ path: { id }, payload: body }));

export const deleteBuild = (id: string) => runApi((api) => api.builds.delete({ path: { id } }));

export const fetchInstallLink = (buildId: string) =>
  runApi((api) => api.builds.getInstallLink({ path: { id: buildId } }));

// ---------------------------------------------------------------------------
// Credentials — Query options
// ---------------------------------------------------------------------------

export const credentialsQueryOptions = (
  orgId: string,
  filters?: { platform?: "ios" | "android"; type?: string; distribution?: string },
  page?: number,
) =>
  queryOptions({
    queryKey: [
      "org",
      orgId,
      "credentials",
      {
        platform: filters?.platform,
        type: filters?.type,
        distribution: filters?.distribution,
        page,
      },
    ],
    queryFn: () =>
      runApi((api) =>
        api.credentials.list({
          urlParams: {
            platform: filters?.platform,
            type: filters?.type,
            distribution: filters?.distribution,
            page,
          },
        }),
      ),
    staleTime: 30_000,
  });

// Credentials — Mutations
export const uploadCredential = (body: typeof CreateCredentialBody.Type) =>
  runApi((api) => api.credentials.upload({ payload: body }));

export const activateCredential = (id: string) =>
  runApi((api) => api.credentials.activate({ path: { id } }));

export const deleteCredential = (id: string) =>
  runApi((api) => api.credentials.delete({ path: { id } }));

// ---------------------------------------------------------------------------
// Env Vars — Query options
// ---------------------------------------------------------------------------

export const envVarsQueryOptions = (orgId: string, projectId: string, environment?: string) =>
  queryOptions({
    queryKey: [
      "org",
      orgId,
      "projects",
      projectId,
      "env-vars",
      ...(environment ? [environment] : []),
    ],
    queryFn: () =>
      runApi((api) =>
        api["env-vars"].list({
          urlParams: { projectId, ...(environment ? { environment } : {}) },
        }),
      ),
    staleTime: 30_000,
  });

// Env Vars — Mutations
export const createEnvVar = (body: typeof CreateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].create({ payload: body }));

export const updateEnvVar = (id: string, body: typeof UpdateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].update({ path: { id }, payload: body }));

export const deleteEnvVar = (id: string) =>
  runApi((api) => api["env-vars"].delete({ path: { id } }));

export const bulkImportEnvVars = (body: typeof BulkImportEnvVarsBody.Type) =>
  runApi((api) => api["env-vars"].bulkImport({ payload: body }));
