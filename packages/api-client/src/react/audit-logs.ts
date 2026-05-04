import { infiniteQueryOptions } from "@tanstack/react-query";

import { runApi } from "../index";

export const auditLogsQueryKey = (orgId: string, projectId?: string) =>
  projectId
    ? (["org", orgId, "project", projectId, "audit-logs"] as const)
    : (["org", orgId, "audit-logs"] as const);

export interface AuditLogsFilters {
  readonly projectId?: string;
  readonly resourceType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export const auditLogsInfiniteQueryOptions = (orgId: string, filters?: AuditLogsFilters) =>
  infiniteQueryOptions({
    queryKey: [...auditLogsQueryKey(orgId, filters?.projectId), filters ?? {}],
    queryFn: async ({ signal, pageParam }) =>
      runApi(
        (api) =>
          api["audit-logs"].list({
            urlParams: {
              ...filters,
              cursor: pageParam,
            },
          }),
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- react-query getNextPageParam contract: undefined terminates; API schema returns null
      lastPage.nextCursor ?? undefined,
    staleTime: 10_000,
  });
