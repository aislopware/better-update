import { queryOptions } from "@tanstack/react-query";

import type {
  CreateEnvVarBody,
  EnvVarEnvironment,
  EnvVarListScope,
  UpdateEnvVarBody,
} from "@better-update/api";

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

// Env var VALUE CRUD from the browser env-vault (P4). The dashboard list/get
// still reads metadata only; these mutations carry a CLIENT-SEALED value envelope
// (sealed in the browser with the env-vault key — see @better-update/credentials-crypto
// `sealEnvValue`). The server stays zero-plaintext. All require a fresh WebAuthn
// step-up (cookie transport) enforced server-side. Callers wrap these in
// `useMutation` and invalidate `envVarsQueryKey` / `globalEnvVarsQueryKey` onSuccess.

export const createEnvVar = async (body: typeof CreateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].create({ payload: body }));

export const updateEnvVar = async (id: string, body: typeof UpdateEnvVarBody.Type) =>
  runApi((api) => api["env-vars"].update({ path: { id }, payload: body }));

export const deleteEnvVar = async (id: string) =>
  runApi((api) => api["env-vars"].delete({ path: { id } }));

/** Fetch the active value's sealed envelope for client-side decryption (reveal). */
export const getEnvVarValue = async (id: string) =>
  runApi((api) => api["env-vars"].getValue({ path: { id } }));
