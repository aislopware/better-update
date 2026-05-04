import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { runApi } from "../index";

import type { PlatformValue } from "./types";

export const buildsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "builds"] as const;

export const buildQueryKey = (orgId: string, buildId: string) =>
  ["org", orgId, "build", buildId] as const;

export const buildCompatibilityMatrixQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "build-compatibility-matrix"] as const;

export interface BuildsFilters {
  readonly platform?: PlatformValue;
  readonly profile?: string;
  readonly runtimeVersion?: string;
  readonly limit?: number;
}

export const buildsInfiniteQueryOptions = (
  orgId: string,
  projectId: string,
  filters?: BuildsFilters,
) =>
  infiniteQueryOptions({
    queryKey: [...buildsQueryKey(orgId, projectId), filters ?? {}],
    queryFn: async ({ signal, pageParam }) =>
      runApi(
        (api) =>
          api.builds.list({
            urlParams: {
              projectId,
              ...(filters?.platform ? { platform: filters.platform } : {}),
              ...(filters?.profile ? { profile: filters.profile } : {}),
              ...(filters?.runtimeVersion ? { runtimeVersion: filters.runtimeVersion } : {}),
              ...(filters?.limit ? { limit: filters.limit } : {}),
              cursor: pageParam,
            },
          }),
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- react-query getNextPageParam contract: undefined terminates; API schema returns null
      lastPage.nextCursor ?? undefined,
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
