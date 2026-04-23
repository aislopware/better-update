import { queryOptions } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client";

export type MemberItem = typeof authClient.$Infer.Member;
export type InvitationItem = typeof authClient.$Infer.Invitation;

const loadMembers = async (orgId: string): Promise<MemberItem[]> => {
  const { data } = await authClient.organization.listMembers({
    query: { organizationId: orgId },
  });
  if (data === null) {
    return [];
  }
  return data.members as MemberItem[];
};

const loadInvitations = async (orgId: string): Promise<InvitationItem[]> => {
  const { data } = await authClient.organization.listInvitations({
    query: { organizationId: orgId },
  });
  if (data === null) {
    return [];
  }
  return data as InvitationItem[];
};

export const membersQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "members"],
    queryFn: async () => loadMembers(orgId),
    staleTime: 30_000,
  });

export const invitationsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "invitations"],
    queryFn: async () => loadInvitations(orgId),
    staleTime: 30_000,
  });
