import { queryOptions } from "@tanstack/react-query";

import type { RobotAccount, UpdateRobotAccountBody } from "@better-update/api";

import { runApi } from "../index";

// A project-scoped robot account as returned by the IAM-gated list endpoint
// (the hashed bearer secret is never exposed — only `bearerStart` for
// identification).
export type RobotAccountItem = typeof RobotAccount.Type;
export type RobotAccountRoleValue = RobotAccountItem["role"];

export const projectRobotAccountsQueryKey = (projectId: string) =>
  ["project", projectId, "robot-accounts"] as const;

// Robot accounts are created/rotated/revoked exclusively from the CLI (minting
// the age keypair client-side is not something the dashboard can do without
// breaking the zero-knowledge vault design). Renaming and role changes carry no
// key material, so `updateRobotAccount` below is the one dashboard mutation.
export const projectRobotAccountsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: projectRobotAccountsQueryKey(projectId),
    queryFn: async ({ signal }) => {
      const result = await runApi(
        (api) => api["robot-accounts"].list({ urlParams: { projectId } }),
        signal,
      );
      return result.items;
    },
    staleTime: 30_000,
  });

export const orgRobotAccountsQueryKey = (orgId: string) =>
  ["org", orgId, "robot-accounts"] as const;

/** Every robot account in the org — resolves a machine key to its owning robot on the vault access view. */
export const orgRobotAccountsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: orgRobotAccountsQueryKey(orgId),
    queryFn: async ({ signal }) => {
      const result = await runApi((api) => api["robot-accounts"].list({ urlParams: {} }), signal);
      return result.items;
    },
    staleTime: 30_000,
  });

// Rename a robot and/or change its project role in place (Maintainer+ on its
// project; audit-logged server-side). The project itself is fixed at creation.
export const updateRobotAccount = async (id: string, body: typeof UpdateRobotAccountBody.Type) =>
  runApi((api) => api["robot-accounts"].update({ path: { id }, payload: body }));
