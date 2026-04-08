import { queryOptions } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client";

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
