import { queryOptions } from "@tanstack/react-query";

import { runApi } from "../index";

export const auditLogsQueryKey = (orgId: string, projectId?: string) =>
  projectId
    ? (["org", orgId, "project", projectId, "audit-logs"] as const)
    : (["org", orgId, "audit-logs"] as const);

export const auditLogsQueryOptions = (
  orgId: string,
  filters?: {
    projectId?: string;
    action?: string;
    resourceType?: string;
    actorId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  },
) =>
  queryOptions({
    queryKey: [...auditLogsQueryKey(orgId, filters?.projectId), filters],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api["audit-logs"].list({
            urlParams: { ...filters },
          }),
        signal,
      ),
    staleTime: 10_000,
  });
