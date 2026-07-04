import { queryOptions } from "@tanstack/react-query";

import type { Me } from "@better-update/api";

import { runApi } from "../index";

// The current actor + active organization, including the org role, project
// roles, and the per-action capabilities the UI gates on — computed
// server-side from the role matrix so the UI never diverges from the
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

// Change a member's org role (GITLAB-RBAC-SPEC §2): admin ⇄ member. Gated by
// member:update; granting/revoking admin is owner-only (server guard).
export const updateMemberRole = async (id: string, role: "admin" | "member") =>
  runApi((api) => api.members.updateRole({ path: { id }, payload: { role } }));
