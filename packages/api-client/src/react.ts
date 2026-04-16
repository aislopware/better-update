import {
  AssetUploadBody,
  Branch,
  BulkImportEnvVarsBody,
  CreateBranchBody,
  CreateBranchRolloutBody,
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

export const projectsQueryKey = (orgId: string) => ["org", orgId, "projects"] as const;

export const projectQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId] as const;

export const branchesQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "branches"] as const;

export const channelsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "channels"] as const;

export const updatesQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "updates"] as const;

export const adoptionQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "analytics", "adoption"] as const;

export const updateAnalyticsQueryKey = (orgId: string, projectId: string, updateId: string) =>
  ["org", orgId, "project", projectId, "analytics", "updates", updateId] as const;

export const channelAnalyticsQueryKey = (orgId: string, projectId: string, channel: string) =>
  ["org", orgId, "project", projectId, "analytics", "channels", channel] as const;

export const platformAnalyticsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "analytics", "platforms"] as const;

export const projectsQueryOptions = (orgId: string, page?: number) =>
  queryOptions({
    queryKey: [...projectsQueryKey(orgId), ...(page != null ? [page] : [])],
    queryFn: ({ signal }) => runApi((api) => api.projects.list({ urlParams: { page } }), signal),
    staleTime: 30_000,
  });

export const projectQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: projectQueryKey(orgId, projectId),
    queryFn: ({ signal }) => runApi((api) => api.projects.get({ path: { id: projectId } }), signal),
    staleTime: 30_000,
  });

export const branchesQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: branchesQueryKey(orgId, projectId),
    queryFn: ({ signal }) =>
      runApi((api) => api.branches.list({ urlParams: { projectId, limit: 1000 } }), signal),
    staleTime: 30_000,
  });

export const channelsQueryOptions = (orgId: string, projectId: string, limit?: number) =>
  queryOptions({
    queryKey: [...channelsQueryKey(orgId, projectId), ...(limit != null ? [limit] : [])],
    queryFn: ({ signal }) =>
      runApi((api) => api.channels.list({ urlParams: { projectId, limit } }), signal),
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
      ...updatesQueryKey(orgId, projectId),
      ...(branchId ? [branchId] : []),
      ...(limit != null ? [limit] : []),
    ],
    queryFn: ({ signal }) =>
      runApi((api) => api.updates.list({ urlParams: { projectId, branchId, limit } }), signal),
    staleTime: 30_000,
  });

export const adoptionQueryOptions = (orgId: string, projectId: string, period?: AnalyticsPeriod) =>
  queryOptions({
    queryKey: [...adoptionQueryKey(orgId, projectId), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi((api) => api.analytics.adoption({ urlParams: { projectId, period } }), signal),
    staleTime: 60_000,
  });

export const updateAnalyticsQueryOptions = (
  orgId: string,
  projectId: string,
  updateId: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...updateAnalyticsQueryKey(orgId, projectId, updateId), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi(
        (api) => api.analytics.updates({ urlParams: { projectId, updateId, period } }),
        signal,
      ),
    staleTime: 60_000,
  });

export const channelAnalyticsQueryOptions = (
  orgId: string,
  projectId: string,
  channel: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...channelAnalyticsQueryKey(orgId, projectId, channel), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi(
        (api) => api.analytics.channels({ urlParams: { projectId, channel, period } }),
        signal,
      ),
    staleTime: 60_000,
  });

export const platformAnalyticsQueryOptions = (
  orgId: string,
  projectId: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...platformAnalyticsQueryKey(orgId, projectId), ...(period ? [period] : [])],
    queryFn: ({ signal }) =>
      runApi((api) => api.analytics.platforms({ urlParams: { projectId, period } }), signal),
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

export const finalizeAsset = (hash: string) =>
  runApi((api) => api.assets.finalize({ path: { hash } }));

// ---------------------------------------------------------------------------
// Builds — Query options
// ---------------------------------------------------------------------------

export const buildsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "builds"] as const;

export const buildQueryKey = (orgId: string, buildId: string) =>
  ["org", orgId, "build", buildId] as const;

export const buildCompatibilityMatrixQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "build-compatibility-matrix"] as const;

export const buildsQueryOptions = (
  orgId: string,
  projectId: string,
  filters?: { platform?: "ios" | "android"; profile?: string; runtimeVersion?: string },
  page?: number,
) =>
  queryOptions({
    queryKey: [
      ...buildsQueryKey(orgId, projectId),
      {
        platform: filters?.platform,
        profile: filters?.profile,
        runtimeVersion: filters?.runtimeVersion,
        page,
      },
    ],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api.builds.list({
            urlParams: {
              projectId,
              platform: filters?.platform,
              profile: filters?.profile,
              runtimeVersion: filters?.runtimeVersion,
              page,
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const buildQueryOptions = (orgId: string, buildId: string) =>
  queryOptions({
    queryKey: buildQueryKey(orgId, buildId),
    queryFn: ({ signal }) => runApi((api) => api.builds.get({ path: { id: buildId } }), signal),
    staleTime: 30_000,
  });

export const buildCompatibilityMatrixQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
    queryFn: ({ signal }) =>
      runApi((api) => api.builds.compatibilityMatrix({ urlParams: { projectId } }), signal),
    staleTime: 30_000,
  });

// Builds — Mutations
export const deleteBuild = (id: string) => runApi((api) => api.builds.delete({ path: { id } }));

export const fetchInstallLink = (buildId: string) =>
  runApi((api) => api.builds.getInstallLink({ path: { id: buildId } }));

// ---------------------------------------------------------------------------
// Credentials — Query options
// ---------------------------------------------------------------------------

export const credentialsQueryKey = (orgId: string) => ["org", orgId, "credentials"] as const;

export const credentialsQueryOptions = (
  orgId: string,
  filters?: { platform?: "ios" | "android"; type?: string; distribution?: string },
  page?: number,
) =>
  queryOptions({
    queryKey: [
      ...credentialsQueryKey(orgId),
      {
        platform: filters?.platform,
        type: filters?.type,
        distribution: filters?.distribution,
        page,
      },
    ],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api.credentials.list({
            urlParams: {
              platform: filters?.platform,
              type: filters?.type,
              distribution: filters?.distribution,
              page,
            },
          }),
        signal,
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

export const envVarsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "env-vars"] as const;

export const envVarsQueryOptions = (orgId: string, projectId: string, environment?: string) =>
  queryOptions({
    queryKey: [...envVarsQueryKey(orgId, projectId), ...(environment ? [environment] : [])],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api["env-vars"].list({
            urlParams: { projectId, ...(environment ? { environment } : {}), limit: 100 },
          }),
        signal,
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

// ---------------------------------------------------------------------------
// Audit Logs — Query options
// ---------------------------------------------------------------------------

export const auditLogsQueryKey = (orgId: string) => ["org", orgId, "audit-logs"] as const;

export const auditLogsQueryOptions = (
  orgId: string,
  filters?: {
    action?: string;
    resourceType?: string;
    actorId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  },
) =>
  queryOptions({
    queryKey: [...auditLogsQueryKey(orgId), filters],
    queryFn: ({ signal }) =>
      runApi(
        (api) =>
          api["audit-logs"].list({
            urlParams: { ...filters },
          }),
        signal,
      ),
    staleTime: 10_000,
  });
