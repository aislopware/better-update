import { queryOptions } from "@tanstack/react-query";

import type { EnvVarEnvironment, EnvVarListScope } from "@better-update/api";

import { runApi } from "../index";

export interface EnvVarsFilters {
  readonly scope?: typeof EnvVarListScope.Type;
  readonly environments?: readonly (typeof EnvVarEnvironment.Type)[];
  readonly search?: string;
}

const filtersKey = (filters?: EnvVarsFilters): readonly unknown[] => {
  const search = filters?.search ?? "(none)";
  return [filters?.scope ?? "default", filters?.environments ?? [], search];
};

const filtersToUrlParams = (filters?: EnvVarsFilters) => ({
  ...(filters?.scope ? { scope: filters.scope } : {}),
  ...(filters?.environments && filters.environments.length > 0
    ? { environments: filters.environments.join(",") }
    : {}),
  ...(filters?.search ? { search: filters.search } : {}),
});

export const envVarsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "env-vars"] as const;

export const envVarsQueryOptions = (orgId: string, projectId: string, filters?: EnvVarsFilters) =>
  queryOptions({
    queryKey: [...envVarsQueryKey(orgId, projectId), ...filtersKey(filters)],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api["env-vars"].list({
            urlParams: { projectId, limit: 100, ...filtersToUrlParams(filters) },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const globalEnvVarsQueryKey = (orgId: string) => ["org", orgId, "global-env-vars"] as const;

export const globalEnvVarsQueryOptions = (orgId: string, filters?: EnvVarsFilters) =>
  queryOptions({
    queryKey: [...globalEnvVarsQueryKey(orgId), ...filtersKey(filters)],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api["env-vars"].list({
            urlParams: { scope: "global", limit: 100, ...filtersToUrlParams(filters) },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

// Env var values are end-to-end encrypted: the dashboard reads metadata only.
// Create / update / delete / import all happen in the CLI (`better-update env …`),
// which holds the org vault key — so there are deliberately no mutation bindings.
