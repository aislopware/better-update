import { compact } from "@better-update/type-guards";
import { queryOptions } from "@tanstack/react-query";

import type { AdminUserStatus } from "@better-update/api";

import { runApi } from "../index";

export const adminUsersQueryKey = ["admin", "users"] as const;

export interface AdminUsersFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly search?: string;
  readonly status?: AdminUserStatus;
}

export const adminUsersQueryOptions = (filters?: AdminUsersFilters) =>
  queryOptions({
    queryKey: [...adminUsersQueryKey, filters ?? {}],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.admin.listUsers({
            urlParams: compact({
              page: filters?.page,
              limit: filters?.limit,
              search: filters?.search,
              status: filters?.status,
            }),
          }),
        signal,
      ),
    staleTime: 30_000,
  });

export const approveUser = async (userId: string) =>
  runApi((api) => api.admin.approveUser({ path: { userId } }));

export const revokeUser = async (userId: string) =>
  runApi((api) => api.admin.revokeUser({ path: { userId } }));
