import { queryOptions } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client";

export const membersQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "members"],
    queryFn: async () => {
      const { data } = await authClient.organization.listMembers({
        query: { organizationId: orgId },
      });
      return data?.members ?? [];
    },
  });

export const invitationsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "invitations"],
    queryFn: async () => {
      const { data } = await authClient.organization.listInvitations({
        query: { organizationId: orgId },
      });
      return data ?? [];
    },
  });
