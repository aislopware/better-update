import { queryOptions } from "@tanstack/react-query";

import type { AddGroupMemberBody, CreateGroupBody, UpdateGroupBody } from "@better-update/api";

import { runApi } from "../index";

export const groupsQueryKey = (orgId: string) => ["org", orgId, "groups"] as const;

export const groupQueryKey = (orgId: string, groupId: string) =>
  ["org", orgId, "groups", groupId] as const;

export const groupMembersQueryKey = (orgId: string, groupId: string) =>
  ["org", orgId, "groups", groupId, "members"] as const;

export const groupsQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: groupsQueryKey(orgId),
    queryFn: async ({ signal }) => runApi((api) => api.groups.list(), signal),
    staleTime: 30_000,
  });

export const groupQueryOptions = (orgId: string, groupId: string) =>
  queryOptions({
    queryKey: groupQueryKey(orgId, groupId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.groups.get({ path: { id: groupId } }), signal),
    staleTime: 30_000,
  });

export const groupMembersQueryOptions = (orgId: string, groupId: string) =>
  queryOptions({
    queryKey: groupMembersQueryKey(orgId, groupId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.groups.listMembers({ path: { id: groupId } }), signal),
    staleTime: 30_000,
  });

export const createGroup = async (body: typeof CreateGroupBody.Type) =>
  runApi((api) => api.groups.create({ payload: body }));

export const updateGroup = async (id: string, body: typeof UpdateGroupBody.Type) =>
  runApi((api) => api.groups.update({ path: { id }, payload: body }));

export const deleteGroup = async (id: string) =>
  runApi((api) => api.groups.delete({ path: { id } }));

export const addGroupMember = async (groupId: string, body: typeof AddGroupMemberBody.Type) =>
  runApi((api) => api.groups.addMember({ path: { id: groupId }, payload: body }));

export const removeGroupMember = async (groupId: string, memberId: string) =>
  runApi((api) => api.groups.removeMember({ path: { id: groupId, memberId } }));
