import { queryOptions } from "@tanstack/react-query";

import type { ApiKey, CreateApiKeyBody } from "@better-update/api";

import { runApi } from "../index";

// One organization API key as returned by the IAM-gated list endpoint (the
// hashed secret is never exposed — only `start` for identification).
export type ApiKeyItem = typeof ApiKey.Type;

export const apiKeysQueryKey = (orgId: string) => ["org", orgId, "api-keys"] as const;

export const apiKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: apiKeysQueryKey(orgId),
    queryFn: async ({ signal }) => {
      const result = await runApi((api) => api["api-keys"].list(), signal);
      return result.items;
    },
    staleTime: 30_000,
  });

// Mint a new key for the active org (IAM-gated by apiKey:create). The plaintext
// `key` is on the returned object and is shown to the user exactly once.
export const createApiKey = async (body: typeof CreateApiKeyBody.Type) =>
  runApi((api) => api["api-keys"].create({ payload: body }));

export const revokeApiKey = async (id: string) =>
  runApi((api) => api["api-keys"].revoke({ path: { id } }));
