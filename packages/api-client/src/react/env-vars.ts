import { queryOptions } from "@tanstack/react-query";

import type { BulkImportEnvVarsBody, CreateEnvVarBody, UpdateEnvVarBody } from "@better-update/api";

import { runApi } from "../index";

export const envVarsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "env-vars"] as const;

export const envVarsQueryOptions = (orgId: string, projectId: string, environment?: string) =>
  queryOptions({
    queryKey: [...envVarsQueryKey(orgId, projectId), ...(environment ? [environment] : [])],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api["env-vars"].list({
            urlParams: { projectId, ...(environment ? { environment } : {}), limit: 100 },
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const createEnvVar = async (body: typeof CreateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].create({ payload: body }));

export const updateEnvVar = async (id: string, body: typeof UpdateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].update({ path: { id }, payload: body }));

export const deleteEnvVar = async (id: string) =>
  runApi((api) => api["env-vars"].delete({ path: { id } }));

export const bulkImportEnvVars = async (body: typeof BulkImportEnvVarsBody.Type) =>
  runApi((api) => api["env-vars"].bulkImport({ payload: body }));
