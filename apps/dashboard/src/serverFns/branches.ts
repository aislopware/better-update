import { createServerFn } from "@tanstack/react-start";

import type { Branch } from "@better-update/api";

import { fetchInternalApi, isPaginatedResponse } from "./internal-api";

import type { PaginatedResponse } from "./internal-api";

export type BranchItem = typeof Branch.Type;

type BranchListResponse = PaginatedResponse<BranchItem>;

export const getBranchesFn = createServerFn({ method: "GET" })
  .inputValidator((input: { projectId: string; page?: number; limit?: number }) => input)
  .handler(async ({ data }) => {
    const params = new URLSearchParams({ projectId: data.projectId });
    if (data.page !== undefined) {
      params.set("page", String(data.page));
    }
    if (data.limit !== undefined) {
      params.set("limit", String(data.limit));
    }

    return fetchInternalApi(
      `/api/branches?${params.toString()}`,
      (value): value is BranchListResponse => isPaginatedResponse(value),
      { items: [], total: 0, page: 1, limit: 20 } as BranchListResponse,
    );
  });
