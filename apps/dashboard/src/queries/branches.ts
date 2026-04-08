import { queryOptions } from "@tanstack/react-query";

import { getBranchesFn } from "../serverFns/branches";

export type { BranchItem } from "../serverFns/branches";

export const branchesQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "projects", projectId, "branches"],
    queryFn: async () => getBranchesFn({ data: { projectId, limit: 1000 } }),
    staleTime: 30_000,
  });
