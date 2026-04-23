import { queryOptions } from "@tanstack/react-query";

import type { ApiKey } from "@better-auth/api-key";

import { authClient } from "../lib/auth-client";

export type ApiKeyItem = Omit<ApiKey, "key">;

const loadApiKeys = async (orgId: string): Promise<ApiKeyItem[]> => {
  const { data } = await authClient.apiKey.list({
    query: { organizationId: orgId },
  });
  if (data === null) {
    return [];
  }
  return data.apiKeys;
};

export const apiKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "api-keys"],
    queryFn: async () => loadApiKeys(orgId),
    staleTime: 30_000,
  });
