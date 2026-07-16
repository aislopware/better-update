import { resolveEnvVarOverrides } from "@better-update/api";
import { queryOptions } from "@tanstack/react-query";

import type {
  CreateEnvVarBody,
  EnvVar,
  EnvVarEnvironment,
  EnvVarListScope,
  UpdateEnvVarBody,
  UpsertEnvVarDescriptionBody,
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

const ENV_VARS_PAGE_LIMIT = 100;
// Backstop against a buggy `hasMore` looping forever: the server caps each scope
// at 5000 vars, so scope=all tops out at 100 full pages.
const ENV_VARS_MAX_PAGES = 120;

interface EnvVarListUrlParams {
  readonly scope?: typeof EnvVarListScope.Type;
  readonly projectId?: string;
  readonly environments?: string;
  readonly search?: string;
}

const fetchPages = async (
  urlParams: EnvVarListUrlParams,
  page: number,
  signal?: AbortSignal,
): Promise<readonly EnvVar[]> => {
  const result = await runApi(
    (api) =>
      api["env-vars"].list({
        urlParams: { ...urlParams, page, limit: ENV_VARS_PAGE_LIMIT },
      }),
    signal,
  );
  // `hasMore` (raw page full), not a short `items`, signals further pages — the
  // server filters unreadable rows AFTER paging. Absent field = pre-hasMore server.
  if (!result.hasMore || page >= ENV_VARS_MAX_PAGES) {
    return result.items;
  }
  return [...result.items, ...(await fetchPages(urlParams, page + 1, signal))];
};

/** Fetch the COMPLETE list (every page) — consumers paginate/filter client-side. */
const fetchAllEnvVars = async (urlParams: EnvVarListUrlParams, signal?: AbortSignal) => ({
  items: resolveEnvVarOverrides(await fetchPages(urlParams, 1, signal)),
});

export const envVarsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "projects", projectId, "env-vars"] as const;

export const envVarsQueryOptions = (orgId: string, projectId: string, filters?: EnvVarsFilters) =>
  queryOptions({
    queryKey: [...envVarsQueryKey(orgId, projectId), ...filtersKey(filters)],
    queryFn: async ({ signal }) =>
      fetchAllEnvVars({ projectId, ...filtersToUrlParams(filters) }, signal),
    staleTime: 30_000,
  });

export const globalEnvVarsQueryKey = (orgId: string) => ["org", orgId, "global-env-vars"] as const;

export const globalEnvVarsQueryOptions = (orgId: string, filters?: EnvVarsFilters) =>
  queryOptions({
    queryKey: [...globalEnvVarsQueryKey(orgId), ...filtersKey(filters)],
    queryFn: async ({ signal }) =>
      fetchAllEnvVars({ scope: "global", ...filtersToUrlParams(filters) }, signal),
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

// Upsert a variable's non-secret label + description (shared per scope + key,
// across every environment). Unlike the value/visibility mutations above this
// needs NO vault and NO WebAuthn step-up — it edits documentation, not a secret —
// so the dashboard can offer it even while the env-vault is locked. Callers wrap
// it in `useMutation` and invalidate the env-var list keys onSuccess.
export const updateEnvVarDescription = async (body: typeof UpsertEnvVarDescriptionBody.Type) =>
  runApi((api) => api["env-vars"].upsertDescription({ payload: body }));

/** Fetch the active value's sealed envelope for client-side decryption (reveal). */
export const getEnvVarValue = async (id: string) =>
  runApi((api) => api["env-vars"].getValue({ path: { id } }));
