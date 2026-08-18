import { queryOptions } from "@tanstack/react-query";

import { runApi } from "../index";

import type { AnalyticsPeriod } from "./types";

/**
 * Query options for the analytics group. Split out of `projects` because these
 * hang off a reporting period as well as a project — the period is part of the
 * key, so every one of them is a family of caches rather than a single entry.
 */

export const adoptionQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "analytics", "adoption"] as const;

export const updateAnalyticsQueryKey = (orgId: string, projectId: string, updateId: string) =>
  ["org", orgId, "project", projectId, "analytics", "updates", updateId] as const;

export const channelAnalyticsQueryKey = (orgId: string, projectId: string, channel: string) =>
  ["org", orgId, "project", projectId, "analytics", "channels", channel] as const;

export const platformAnalyticsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "analytics", "platforms"] as const;

export const deliveryAnalyticsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "analytics", "downloads"] as const;

/**
 * Shipping activity. Without a project it covers the whole organization, so the
 * key hangs off the org and carries the scope as its last segment.
 */
export const activityQueryKey = (orgId: string, projectId: string | undefined) =>
  ["org", orgId, "analytics", "activity", projectId ?? "org"] as const;

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

export const deliveryAnalyticsQueryOptions = (
  orgId: string,
  projectId: string,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...deliveryAnalyticsQueryKey(orgId, projectId), ...(period ? [period] : [])],
    queryFn: async ({ signal }) =>
      runApi((api) => api.analytics.downloads({ urlParams: { projectId, period } }), signal),
    staleTime: 60_000,
  });

/**
 * The same activity, split by project. The key carries the ids because the
 * response only covers what was asked for — a page of the projects list.
 */
export const projectActivityQueryKey = (orgId: string, projectIds: readonly string[]) =>
  ["org", orgId, "analytics", "activity", "by-project", projectIds.toSorted()] as const;

export const projectActivityQueryOptions = (
  orgId: string,
  projectIds: readonly string[],
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...projectActivityQueryKey(orgId, projectIds), ...(period ? [period] : [])],
    queryFn: async ({ signal }) =>
      runApi((api) => api.analytics.projectActivity({ urlParams: { projectIds, period } }), signal),
    enabled: projectIds.length > 0,
    staleTime: 60_000,
  });

export const activityQueryOptions = (
  orgId: string,
  projectId: string | undefined,
  period?: AnalyticsPeriod,
) =>
  queryOptions({
    queryKey: [...activityQueryKey(orgId, projectId), ...(period ? [period] : [])],
    queryFn: async ({ signal }) =>
      runApi((api) => api.analytics.activity({ urlParams: { projectId, period } }), signal),
    staleTime: 60_000,
  });
