import { queryOptions } from "@tanstack/react-query";

import { getOrgsFn, getSessionFn } from "../serverFns/auth";

export const sessionQueryOptions = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: async () => getSessionFn(),
  staleTime: 5 * 60 * 1000,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});

export const orgsQueryOptions = queryOptions({
  queryKey: ["auth", "orgs"],
  queryFn: async () => getOrgsFn(),
  staleTime: 5 * 60 * 1000,
});
