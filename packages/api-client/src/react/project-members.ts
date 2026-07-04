import { queryOptions } from "@tanstack/react-query";

import type { ProjectMember, UpsertProjectMemberBody } from "@better-update/api";

import { runApi } from "../index";

// Per-project membership (GITLAB-RBAC-SPEC §1): members/robots holding a role
// on the project. Org owner/admin are implicit maintainers and never appear.
export type ProjectMemberItem = typeof ProjectMember.Type;
export type ProjectMemberRoleValue = ProjectMemberItem["role"];
export type ProjectMemberPrincipalTypeValue = ProjectMemberItem["principalType"];

export const projectMembersQueryKey = (projectId: string) =>
  ["project", projectId, "members"] as const;

export const projectMembersQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: projectMembersQueryKey(projectId),
    queryFn: async ({ signal }) => {
      const result = await runApi(
        (api) => api["project-members"].list({ path: { id: projectId } }),
        signal,
      );
      return result.items;
    },
    staleTime: 30_000,
  });

// Grant a principal a role on the project (Maintainer+; idempotent upsert).
export const addProjectMember = async (
  projectId: string,
  body: typeof UpsertProjectMemberBody.Type,
) => runApi((api) => api["project-members"].add({ path: { id: projectId }, payload: body }));

// Change an existing project member's role (Maintainer+).
export const updateProjectMemberRole = async (
  projectId: string,
  principalId: string,
  body: { principalType: ProjectMemberPrincipalTypeValue; role: ProjectMemberRoleValue },
) =>
  runApi((api) =>
    api["project-members"].updateRole({ path: { id: projectId, principalId }, payload: body }),
  );

// Drop a principal's role on the project (Maintainer+).
export const removeProjectMember = async (
  projectId: string,
  principalId: string,
  principalType: ProjectMemberPrincipalTypeValue,
) =>
  runApi((api) =>
    api["project-members"].remove({
      path: { id: projectId, principalId },
      urlParams: { principalType },
    }),
  );
