import { queryOptions } from "@tanstack/react-query";

import { getProjectFn } from "../serverFns/project";

export type { ProjectDetail } from "../serverFns/project";

export const projectQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["project", projectId],
    queryFn: async () => getProjectFn({ data: { projectId } }),
    staleTime: 30_000,
  });
