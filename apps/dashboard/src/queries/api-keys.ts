import { queryOptions } from "@tanstack/react-query";

import type { ApiKey } from "@better-auth/api-key/types";

import { authClient } from "../lib/auth-client";

export type ApiKeyItem = Pick<
  ApiKey,
  "id" | "name" | "start" | "prefix" | "createdAt" | "expiresAt"
>;

export const apiKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "api-keys"],
    queryFn: async () => {
      const { data } = await authClient.apiKey.list({
        query: { organizationId: orgId },
      });
      return data?.apiKeys ?? [];
    },
    staleTime: 30_000,
  });
