import { queryOptions } from "@tanstack/react-query";

import type { ApiKey } from "@better-auth/api-key";

import { authClient } from "../lib/auth-client";
import { ensureError } from "../lib/ensure-error";

export type ApiKeyItem = Omit<ApiKey, "key">;

/* eslint-disable functional/no-try-statements, functional/no-promise-reject, functional/no-throw-statements -- queryFn must throw a real Error so TanStack Router/Query CatchBoundary's `if (error)` truthy check works; non-Error rejects (e.g. better-auth throwing undefined) crash render with `Uncaught undefined` */
const loadApiKeys = async (orgId: string): Promise<ApiKeyItem[]> => {
  try {
    const { data } = await authClient.apiKey.list({
      query: { organizationId: orgId },
    });
    if (data === null) {
      return [];
    }
    return data.apiKeys;
  } catch (error) {
    throw ensureError(error, "Failed to load API keys");
  }
};
/* eslint-enable functional/no-try-statements, functional/no-promise-reject, functional/no-throw-statements */

export const apiKeysQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "api-keys"],
    queryFn: async () => loadApiKeys(orgId),
    staleTime: 30_000,
  });
