import { queryOptions } from "@tanstack/react-query";

import { runApi } from "../index";

import type { PlatformValue } from "./types";

export const buildsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "builds"] as const;

export const buildQueryKey = (orgId: string, buildId: string) =>
  ["org", orgId, "build", buildId] as const;

export const buildCompatibilityMatrixQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "build-compatibility-matrix"] as const;

export const buildsQueryOptions = (
  orgId: string,
  projectId: string,
  filters?: { platform?: PlatformValue; profile?: string; runtimeVersion?: string },
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
    queryFn: async ({ signal }) =>
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
