import { queryOptions } from "@tanstack/react-query";

import type { CreateInvitationBody, Invitation } from "@better-update/api";

import { runApi } from "../index";

// One organization invitation as returned by the IAM-gated list endpoint. These
// rows are written by the IAM-gated create endpoint and consumed by
// better-auth's accept-invitation flow.
export type InvitationItem = typeof Invitation.Type;

export const invitationsQueryKey = (orgId: string) => ["org", orgId, "invitations"] as const;

export const invitationsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: invitationsQueryKey(orgId),
    queryFn: async ({ signal }) => {
      const result = await runApi((api) => api.invitations.list(), signal);
      return result.items;
    },
    staleTime: 30_000,
  });

// Invite a member to the active org (IAM-gated by invitation:create). Writes a
// pending row and sends the invite email server-side.
export const createInvitation = async (body: typeof CreateInvitationBody.Type) =>
  runApi((api) => api.invitations.create({ payload: body }));

// Cancel a pending invitation (IAM-gated by invitation:cancel).
export const cancelInvitation = async (id: string) =>
  runApi((api) => api.invitations.cancel({ path: { id } }));
