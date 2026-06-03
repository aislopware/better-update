import { runApi } from "@better-update/api-client";
import { queryOptions } from "@tanstack/react-query";

import type {
  CreateOrgRoleBody,
  DeleteChannelGrantResult,
  DeleteEnvGrantBody,
  DeleteEnvGrantResult,
  DeleteOrgRoleResult,
  UpsertChannelGrantBody,
  UpsertEnvGrantBody,
  UpdateOrgRoleBody,
} from "@better-update/api";

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

// ── Org roles ──────────────────────────────────────────────────────────────

export const orgRolesQueryKey = (orgId: string) => ["org", orgId, "roles"] as const;

export const rolesQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: orgRolesQueryKey(orgId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.roles.list({ urlParams: { organizationId: orgId } }), signal),
    staleTime: 30_000,
  });

export const createOrgRole = async (body: typeof CreateOrgRoleBody.Type) =>
  runApi((api) => api.roles.create({ payload: body }));

export const updateOrgRole = async (id: string, body: typeof UpdateOrgRoleBody.Type) =>
  runApi((api) => api.roles.update({ path: { id }, payload: body }));

export const deleteOrgRole = async (id: string): Promise<typeof DeleteOrgRoleResult.Type> =>
  runApi((api) => api.roles.delete({ path: { id } }));

// ── Channel grants ─────────────────────────────────────────────────────────

export const channelGrantsQueryKey = (channelId: string) =>
  ["channel", channelId, "grants"] as const;

export const channelGrantsQueryOptions = (channelId: string) =>
  queryOptions({
    queryKey: channelGrantsQueryKey(channelId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.channelGrants.list({ path: { id: channelId }, urlParams: {} }), signal),
    staleTime: 30_000,
  });

export const upsertChannelGrant = async (
  channelId: string,
  memberId: string,
  body: typeof UpsertChannelGrantBody.Type,
) =>
  runApi((api) => api.channelGrants.upsert({ path: { id: channelId, memberId }, payload: body }));

export const deleteChannelGrant = async (
  channelId: string,
  memberId: string,
): Promise<typeof DeleteChannelGrantResult.Type> =>
  runApi((api) => api.channelGrants.delete({ path: { id: channelId, memberId } }));

// ── Env-var environment grants ───────────────────────────────────────────────

/** Sentinel project token for the org-global env-var scope (mirrors server). */
export const ENV_GRANT_GLOBAL = "global" as const;

export const envGrantsQueryKey = (projectScope: string) => ["env-grants", projectScope] as const;

export const envGrantsQueryOptions = (projectScope: string) =>
  queryOptions({
    queryKey: envGrantsQueryKey(projectScope),
    queryFn: async ({ signal }) =>
      runApi((api) => api.envGrants.list({ urlParams: { projectId: projectScope } }), signal),
    staleTime: 30_000,
  });

export const upsertEnvGrant = async (body: typeof UpsertEnvGrantBody.Type) =>
  runApi((api) => api.envGrants.upsert({ payload: body }));

export const deleteEnvGrant = async (
  body: typeof DeleteEnvGrantBody.Type,
): Promise<typeof DeleteEnvGrantResult.Type> =>
  runApi((api) => api.envGrants.delete({ payload: body }));
