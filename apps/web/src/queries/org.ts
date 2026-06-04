import { queryOptions } from "@tanstack/react-query";

import { authClient } from "../lib/auth-client";
import { ensureError } from "../lib/ensure-error";

// Invitations are now served by the IAM-gated ManagementApi endpoints
// (POST/GET/DELETE /api/invitations), not the better-auth organization plugin
// route. The typed query helper lives in the api-client; re-exported here so
// existing route imports keep their path. Members still come from better-auth
// (its accept/role/remove flows are unchanged).
export { invitationsQueryKey, invitationsQueryOptions } from "@better-update/api-client/react";
export type { InvitationItem } from "@better-update/api-client/react";

// The current actor + active org, including the per-action capabilities the
// Members page gates on (canInviteMembers / canRemoveMembers / canManagePolicies).
// Computed server-side so the UI never diverges from the authorization gate.
// Re-exported here so route imports keep their path.
export { meQueryKey, meQueryOptions } from "@better-update/api-client/react";

export type MemberItem = typeof authClient.$Infer.Member;

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
/* eslint-enable functional/no-try-statements, functional/no-promise-reject, functional/no-throw-statements */

export const orgKeyPrefix = (orgId: string) => ["org", orgId] as const;

export const membersQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ["org", orgId, "members"],
    queryFn: async () => loadMembers(orgId),
    staleTime: 30_000,
  });
