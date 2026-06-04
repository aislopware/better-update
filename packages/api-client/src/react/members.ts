import { queryOptions } from "@tanstack/react-query";

import type { Me } from "@better-update/api";

import { runApi } from "../index";

// The current actor + active organization, including the per-action
// capabilities the Members UI gates on (canInviteMembers / canRemoveMembers /
// canManagePolicies — each mirroring invitation:create / member:delete /
// policy:update on org). Computed server-side so the UI never diverges from the
// authorization gate.
export type MeResult = typeof Me.Type;

export const meQueryKey = ["me"] as const;

export const meQueryOptions = () =>
  queryOptions({
    queryKey: meQueryKey,
    queryFn: async ({ signal }) => runApi((api) => api.me.get(), signal),
    staleTime: 30_000,
  });

// Remove a member from the active org by member id (IAM-gated by member:delete;
// org-scoped — no cross-org removes; rejects removing the last owner with 409).
export const removeMember = async (id: string) =>
  runApi((api) => api.members.remove({ path: { id } }));
