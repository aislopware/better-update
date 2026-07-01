import { queryOptions } from "@tanstack/react-query";

import type { RobotAccount } from "@better-update/api";

import { runApi } from "../index";

// An org-owned robot account as returned by the IAM-gated list endpoint (the
// hashed bearer secret is never exposed — only `bearerStart` for identification).
export type RobotAccountItem = typeof RobotAccount.Type;

export const robotAccountsQueryKey = (orgId: string) => ["org", orgId, "robot-accounts"] as const;

// Read-only: robot accounts are created/rotated/revoked exclusively from the CLI
// (minting the age keypair client-side is not something the dashboard can do
// without breaking the zero-knowledge vault design), so this exports no mutations.
export const robotAccountsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: robotAccountsQueryKey(orgId),
    queryFn: async ({ signal }) => {
      const result = await runApi((api) => api["robot-accounts"].list(), signal);
      return result.items;
    },
    staleTime: 30_000,
  });
