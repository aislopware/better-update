import { queryOptions } from "@tanstack/react-query";

import type { CreateEnvironmentBody, RenameEnvironmentBody } from "@better-update/api";

import { runApi } from "../index";

export const environmentsQueryKey = (orgId: string) => ["org", orgId, "environments"] as const;

export const environmentsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: environmentsQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.environments.list(), signal),
    staleTime: 30_000,
  });

export const createEnvironment = async (body: typeof CreateEnvironmentBody.Type) =>
  runApi((api) => api.environments.create({ payload: body }));

export const renameEnvironment = async (name: string, body: typeof RenameEnvironmentBody.Type) =>
  runApi((api) => api.environments.rename({ path: { name }, payload: body }));

export const deleteEnvironment = async (name: string) =>
  runApi((api) => api.environments.delete({ path: { name } }));
