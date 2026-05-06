import { queryOptions } from "@tanstack/react-query";

import type {
  CreateBranchBody,
  CreateBranchRolloutBody,
  CreateChannelBody,
  CreateProjectBody,
  CreateUpdateBody,
  RepublishBody,
  UpdateBranchBody,
  UpdateChannelBody,
  UpdateProjectBody,
} from "@better-update/api";

import { runApi } from "../index";

import type { AnalyticsPeriod, PlatformValue } from "./types";

export const projectsQueryKey = (orgId: string) => ["org", orgId, "projects"] as const;

export const projectQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId] as const;

export const projectBySlugQueryKey = (orgId: string, slug: string) =>
  ["org", orgId, "project", "by-slug", slug] as const;

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

export type ProjectSortColumn =
  | "lastActivityAt"
  | "name"
  | "createdAt"
  | "branchCount"
  | "channelCount"
  | "updateCount";

/** Sort param: column name optionally prefixed with `-` for descending. */
export type ProjectSort = ProjectSortColumn | `-${ProjectSortColumn}`;

export interface ProjectsFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly query?: string;
  readonly sort?: ProjectSort;
}

export const projectsQueryOptions = (orgId: string, filters?: ProjectsFilters) =>
  queryOptions({
    queryKey: [...projectsQueryKey(orgId), filters ?? {}],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.projects.list({
            urlParams: {
              ...(filters?.page === undefined ? {} : { page: filters.page }),
              ...(filters?.limit === undefined ? {} : { limit: filters.limit }),
              ...(filters?.query ? { query: filters.query } : {}),
              ...(filters?.sort ? { sort: filters.sort } : {}),
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const projectQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: projectQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.projects.get({ path: { id: projectId } }), signal),
    staleTime: 30_000,
  });

export const projectBySlugQueryOptions = (orgId: string, slug: string) =>
  queryOptions({
    queryKey: projectBySlugQueryKey(orgId, slug),
    queryFn: async ({ signal }) =>
      runApi((api) => api.projects.getBySlug({ path: { slug } }), signal),
    staleTime: 30_000,
  });

export type BranchSortColumn = "name" | "createdAt" | "updateCount";

/** Sort param: column name optionally prefixed with `-` for descending. */
export type BranchSort = BranchSortColumn | `-${BranchSortColumn}`;

export interface BranchesFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly sort?: BranchSort;
}

export const branchesQueryOptions = (orgId: string, projectId: string, filters?: BranchesFilters) =>
  queryOptions({
    queryKey: [...branchesQueryKey(orgId, projectId), filters ?? {}],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.branches.list({
            urlParams: {
              projectId,
              ...(filters?.page === undefined ? {} : { page: filters.page }),
              ...(filters?.limit === undefined ? {} : { limit: filters.limit }),
              ...(filters?.sort ? { sort: filters.sort } : {}),
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export type ChannelSortColumn = "name" | "createdAt";

/** Sort param: column name optionally prefixed with `-` for descending. */
export type ChannelSort = ChannelSortColumn | `-${ChannelSortColumn}`;

export interface ChannelsFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly sort?: ChannelSort;
}

export const channelsQueryOptions = (orgId: string, projectId: string, filters?: ChannelsFilters) =>
  queryOptions({
    queryKey: [...channelsQueryKey(orgId, projectId), filters ?? {}],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.channels.list({
            urlParams: {
              projectId,
              ...(filters?.page === undefined ? {} : { page: filters.page }),
              ...(filters?.limit === undefined ? {} : { limit: filters.limit }),
              ...(filters?.sort ? { sort: filters.sort } : {}),
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export type UpdateSortColumn = "createdAt" | "runtimeVersion" | "platform" | "rolloutPercentage";

/** Sort param: column name optionally prefixed with `-` for descending. */
export type UpdateSort = UpdateSortColumn | `-${UpdateSortColumn}`;

export interface UpdatesFilters {
  readonly branchId?: string;
  readonly platform?: PlatformValue;
  readonly page?: number;
  readonly limit?: number;
  readonly sort?: UpdateSort;
}

export const updatesQueryOptions = (orgId: string, projectId: string, filters?: UpdatesFilters) =>
  queryOptions({
    queryKey: [...updatesQueryKey(orgId, projectId), filters ?? {}],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.updates.list({
            urlParams: {
              projectId,
              ...(filters?.branchId ? { branchId: filters.branchId } : {}),
              ...(filters?.platform ? { platform: filters.platform } : {}),
              ...(filters?.page === undefined ? {} : { page: filters.page }),
              ...(filters?.limit === undefined ? {} : { limit: filters.limit }),
              ...(filters?.sort ? { sort: filters.sort } : {}),
            },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const adoptionQueryOptions = (orgId: string, projectId: string, period?: AnalyticsPeriod) =>
  queryOptions({
    queryKey: [...adoptionQueryKey(orgId, projectId), ...(period ? [period] : [])],
    queryFn: async ({ signal }) =>
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
    queryFn: async ({ signal }) =>
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
    queryFn: async ({ signal }) =>
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
    queryFn: async ({ signal }) =>
      runApi((api) => api.analytics.platforms({ urlParams: { projectId, period } }), signal),
    staleTime: 60_000,
  });

export const createProject = async (body: typeof CreateProjectBody.Type) =>
  runApi((api) => api.projects.create({ payload: body }));

export const renameProject = async (id: string, body: typeof UpdateProjectBody.Type) =>
  runApi((api) => api.projects.rename({ path: { id }, payload: body }));

export const deleteProject = async (id: string) =>
  runApi((api) => api.projects.delete({ path: { id } }));

export const createBranch = async (body: typeof CreateBranchBody.Type) =>
  runApi((api) => api.branches.create({ payload: body }));

export const renameBranch = async (id: string, body: typeof UpdateBranchBody.Type) =>
  runApi((api) => api.branches.rename({ path: { id }, payload: body }));

export const deleteBranch = async (id: string) =>
  runApi((api) => api.branches.delete({ path: { id } }));

export const createChannel = async (body: typeof CreateChannelBody.Type) =>
  runApi((api) => api.channels.create({ payload: body }));

export const updateChannel = async (id: string, body: typeof UpdateChannelBody.Type) =>
  runApi((api) => api.channels.update({ path: { id }, payload: body }));

export const pauseChannel = async (id: string) =>
  runApi((api) => api.channels.pause({ path: { id } }));

export const resumeChannel = async (id: string) =>
  runApi((api) => api.channels.resume({ path: { id } }));

export const deleteChannel = async (id: string) =>
  runApi((api) => api.channels.delete({ path: { id } }));

export const createBranchRollout = async (
  channelId: string,
  body: typeof CreateBranchRolloutBody.Type,
) => runApi((api) => api.channels.createBranchRollout({ path: { id: channelId }, payload: body }));

export const updateBranchRollout = async (channelId: string, body: { percentage: number }) =>
  runApi((api) => api.channels.updateBranchRollout({ path: { id: channelId }, payload: body }));

export const completeBranchRollout = async (channelId: string) =>
  runApi((api) => api.channels.completeBranchRollout({ path: { id: channelId } }));

export const revertBranchRollout = async (channelId: string) =>
  runApi((api) => api.channels.revertBranchRollout({ path: { id: channelId } }));

export const createUpdate = async (body: typeof CreateUpdateBody.Type) =>
  runApi((api) => api.updates.create({ payload: body }));

export const deleteUpdateGroup = async (groupId: string) =>
  runApi((api) => api.updates.deleteGroup({ path: { groupId } }));

export const republishUpdate = async (body: typeof RepublishBody.Type) =>
  runApi((api) => api.updates.republish({ payload: body }));

export const editUpdateRollout = async (id: string, body: { percentage: number }) =>
  runApi((api) => api.updates.editRollout({ path: { id }, payload: body }));

export const completeUpdateRollout = async (id: string) =>
  runApi((api) => api.updates.completeRollout({ path: { id } }));

export const revertUpdateRollout = async (id: string) =>
  runApi((api) => api.updates.revertRollout({ path: { id } }));
