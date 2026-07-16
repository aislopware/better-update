import { queryOptions } from "@tanstack/react-query";

import type { Me, MemberProjectMemberships } from "@better-update/api";

import { runApi } from "../index";

import type { ProjectMemberRoleValue } from "./project-members";

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

// Per-member project memberships for the org Members screen: explicit
// project_member rows (project names embedded server-side) plus the org-wide
// "all projects" role when granted. Owner/admin are implicit maintainers
// everywhere and carry no rows.
export type MemberProjectMembershipsItem = typeof MemberProjectMemberships.Type;

export const memberProjectMembershipsQueryKey = (orgId: string) =>
  ["org", orgId, "member-project-memberships"] as const;

export const memberProjectMembershipsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: memberProjectMembershipsQueryKey(orgId),
    queryFn: async ({ signal }) => {
      const result = await runApi((api) => api.members.listProjectMemberships(), signal);
      return result.items;
    },
    staleTime: 30_000,
  });

// Grant-or-update a member's org-wide ("all projects") role — every project,
// present and future, resolved at query time like org-wide credential
// bindings. Gated by member:update; owners are rejected (implicit maintainers).
export const setMemberAllProjectsRole = async (id: string, role: ProjectMemberRoleValue) =>
  runApi((api) => api.members.setAllProjects({ path: { id }, payload: { role } }));

// Revoke a member's org-wide role; explicit per-project memberships remain.
export const removeMemberAllProjectsRole = async (id: string) =>
  runApi((api) => api.members.removeAllProjects({ path: { id } }));
