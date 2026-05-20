import { queryOptions } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client";
import { ensureError } from "../lib/ensure-error";

export type MemberItem = typeof authClient.$Infer.Member;
export type InvitationItem = typeof authClient.$Infer.Invitation;

/* eslint-disable functional/no-try-statements, functional/no-promise-reject, functional/no-throw-statements -- queryFn must throw a real Error so TanStack Router/Query CatchBoundary's `if (error)` truthy check works; non-Error rejects (e.g. better-auth throwing undefined) crash render with `Uncaught undefined` */
const loadMembers = async (orgId: string): Promise<MemberItem[]> => {
  try {
    const { data } = await authClient.organization.listMembers({
      query: { organizationId: orgId },
    });
    if (data === null) {
      return [];
    }
    return data.members as MemberItem[];
  } catch (error) {
    throw ensureError(error, "Failed to load organization members");
  }
};

const loadInvitations = async (orgId: string): Promise<InvitationItem[]> => {
  try {
    const { data } = await authClient.organization.listInvitations({
      query: { organizationId: orgId },
    });
    if (data === null) {
      return [];
    }
    return data as InvitationItem[];
  } catch (error) {
    throw ensureError(error, "Failed to load organization invitations");
  }
};
/* eslint-enable functional/no-try-statements, functional/no-promise-reject, functional/no-throw-statements */

export const orgKeyPrefix = (orgId: string) => ["org", orgId] as const;

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
