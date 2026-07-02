import { queryOptions } from "@tanstack/react-query";

import type { Me, MemberAccessSummary } from "@better-update/api";

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

// Server-computed access summary per member (org role, project roles,
// capabilities, custom-policy count — direct + group-conferred). Gated by
// policy:read; feeds the Members table's Access column.
export type MemberAccessSummaryItem = typeof MemberAccessSummary.Type;

export const memberAccessSummariesQueryKey = (orgId: string) =>
  ["org", orgId, "member-access-summaries"] as const;

export const memberAccessSummariesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: memberAccessSummariesQueryKey(orgId),
    queryFn: async ({ signal }) => {
      const result = await runApi((api) => api.members.accessSummaries(), signal);
      return result.items;
    },
    staleTime: 30_000,
  });
