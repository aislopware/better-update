import { queryOptions } from "@tanstack/react-query";

import { getApiKeysFn } from "../serverFns/auth";

export const apiKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "api-keys"],
    queryFn: async () => getApiKeysFn({ data: { organizationId: orgId } }),
    staleTime: 30_000,
  });
