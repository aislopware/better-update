import { compact } from "@better-update/type-guards";
import { queryOptions } from "@tanstack/react-query";

import type {
  BuildAudience as BuildAudienceSchema,
  BuildSort as BuildSortSchema,
  BuildSortColumn as BuildSortColumnSchema,
  Distribution as DistributionSchema,
} from "@better-update/api";

import { runApi } from "../index";

import type { PlatformValue } from "./types";

export const buildsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "builds"] as const;

export const buildQueryKey = (orgId: string, buildId: string) =>
  ["org", orgId, "build", buildId] as const;

export const buildCompatibilityMatrixQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "build-compatibility-matrix"] as const;

export type BuildSortColumn = typeof BuildSortColumnSchema.Type;
export type BuildSort = typeof BuildSortSchema.Type;

export type BuildDistribution = typeof DistributionSchema.Type;

export type BuildAudience = typeof BuildAudienceSchema.Type;

export interface BuildsFilters {
  readonly platform?: PlatformValue;
  readonly profile?: string;
  readonly runtimeVersion?: string;
  readonly distribution?: BuildDistribution;
  readonly audience?: BuildAudience;
  readonly query?: string;
  readonly page?: number;
  readonly limit?: number;
  readonly sort?: BuildSort;
}

export const buildsQueryOptions = (orgId: string, projectId: string, filters?: BuildsFilters) =>
  queryOptions({
    queryKey: [...buildsQueryKey(orgId, projectId), filters ?? {}],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.builds.list({
            urlParams: compact({
              projectId,
              platform: filters?.platform,
              profile: filters?.profile,
              runtimeVersion: filters?.runtimeVersion,
              distribution: filters?.distribution,
              audience: filters?.audience,
              query: filters?.query,
              page: filters?.page,
              limit: filters?.limit,
              sort: filters?.sort,
            }),
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const buildQueryOptions = (orgId: string, buildId: string) =>
  queryOptions({
    queryKey: buildQueryKey(orgId, buildId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.builds.get({ path: { id: buildId } }), signal),
    staleTime: 30_000,
  });

export const buildCompatibilityMatrixQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.builds.compatibilityMatrix({ urlParams: { projectId } }), signal),
    staleTime: 30_000,
  });

export const deleteBuild = async (id: string) =>
  runApi((api) => api.builds.delete({ path: { id } }));

export const fetchInstallLink = async (buildId: string) =>
  runApi((api) => api.builds.getInstallLink({ path: { id: buildId } }));
