import { queryOptions } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client";

export const sessionQueryOptions = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: async () => {
    const { data } = await authClient.getSession();
    return data;
  },
  staleTime: 5 * 60 * 1000,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
});

export const orgsQueryOptions = queryOptions({
  queryKey: ["auth", "orgs"],
  queryFn: async () => {
    const { data } = await authClient.organization.list();
    return data ?? [];
  },
  staleTime: 5 * 60 * 1000,
});
