import { queryOptions } from "@tanstack/react-query";

import { getProjectsFn } from "../serverFns/projects";

export type { ProjectItem } from "../serverFns/projects";

export const projectsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "projects"],
    queryFn: async () => getProjectsFn(),
    staleTime: 30_000,
  });
