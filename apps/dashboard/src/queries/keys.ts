import { queryOptions } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client";

export const authKeys = {
  session: ["auth", "session"] as const,
  orgs: ["auth", "orgs"] as const,
};

export const orgKeys = (orgId: string) => ({
  all: ["org", orgId] as const,
  projects: () =>
    queryOptions({
      queryKey: ["org", orgId, "projects"] as const,
      queryFn: async () => {
        const response = await fetch("/api/projects");
        if (!response.ok) {
          throw new Error("Failed to fetch projects");
        }
        return response.json();
      },
      staleTime: 30_000,
    }),
  members: () =>
    queryOptions({
      queryKey: ["org", orgId, "members"] as const,
      queryFn: async () => {
        const { data } = await authClient.organization.listMembers({
          query: { organizationId: orgId },
        });
        return data ?? [];
      },
      staleTime: 60_000,
    }),
  invitations: () =>
    queryOptions({
      queryKey: ["org", orgId, "invitations"] as const,
      queryFn: async () => {
        const { data } = await authClient.organization.listInvitations({
          query: { organizationId: orgId },
        });
        return data ?? [];
      },
      staleTime: 60_000,
    }),
  apiKeys: () =>
    queryOptions({
      queryKey: ["org", orgId, "api-keys"] as const,
      queryFn: async () => {
        const { data } = await authClient.apiKey.list({
          query: { organizationId: orgId },
        });
        return data ?? [];
      },
      staleTime: 60_000,
    }),
});
