import { queryOptions } from "@tanstack/react-query";

import type { CreatePolicyBody, UpdatePolicyBody } from "@better-update/api";

import { runApi } from "../index";

export const policiesQueryKey = (orgId: string) => ["org", orgId, "policies"] as const;

export const policyQueryKey = (orgId: string, policyId: string) =>
  ["org", orgId, "policies", policyId] as const;

export const policiesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: policiesQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.policies.list(), signal),
    staleTime: 30_000,
  });

export const policyQueryOptions = (orgId: string, policyId: string) =>
  queryOptions({
    queryKey: policyQueryKey(orgId, policyId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.policies.get({ path: { id: policyId } }), signal),
    staleTime: 30_000,
  });

export const createPolicy = async (body: typeof CreatePolicyBody.Type) =>
  runApi((api) => api.policies.create({ payload: body }));

export const updatePolicy = async (id: string, body: typeof UpdatePolicyBody.Type) =>
  runApi((api) => api.policies.update({ path: { id }, payload: body }));

export const deletePolicy = async (id: string) =>
  runApi((api) => api.policies.delete({ path: { id } }));
