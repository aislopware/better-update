import { queryOptions } from "@tanstack/react-query";

import type { AttachPolicyBody } from "@better-update/api";

import { runApi } from "../index";

// Managed preset ids contain a colon (`managed:admin`); the Effect HTTP client
// interpolates path params verbatim, so encode the policy id before it becomes a
// path segment on detach. The server URL-decodes the segment back.
const encodePolicyId = (policyId: string): string => encodeURIComponent(policyId);

export const memberPoliciesQueryKey = (orgId: string, memberId: string) =>
  ["org", orgId, "members", memberId, "policies"] as const;

export const groupPoliciesQueryKey = (orgId: string, groupId: string) =>
  ["org", orgId, "groups", groupId, "policies"] as const;

export const robotPoliciesQueryKey = (orgId: string, robotId: string) =>
  ["org", orgId, "robot-accounts", robotId, "policies"] as const;

export const memberPoliciesQueryOptions = (orgId: string, memberId: string) =>
  queryOptions({
    queryKey: memberPoliciesQueryKey(orgId, memberId),
    queryFn: async ({ signal }) =>
      runApi((api) => api["policy-attachments"].listForMember({ path: { id: memberId } }), signal),
    staleTime: 30_000,
  });

export const groupPoliciesQueryOptions = (orgId: string, groupId: string) =>
  queryOptions({
    queryKey: groupPoliciesQueryKey(orgId, groupId),
    queryFn: async ({ signal }) =>
      runApi((api) => api["policy-attachments"].listForGroup({ path: { id: groupId } }), signal),
    staleTime: 30_000,
  });

export const robotPoliciesQueryOptions = (orgId: string, robotId: string) =>
  queryOptions({
    queryKey: robotPoliciesQueryKey(orgId, robotId),
    queryFn: async ({ signal }) =>
      runApi((api) => api["policy-attachments"].listForRobot({ path: { id: robotId } }), signal),
    staleTime: 30_000,
  });

export const attachPolicyToMember = async (memberId: string, body: typeof AttachPolicyBody.Type) =>
  runApi((api) =>
    api["policy-attachments"].attachToMember({ path: { id: memberId }, payload: body }),
  );

export const detachPolicyFromMember = async (memberId: string, policyId: string) =>
  runApi((api) =>
    api["policy-attachments"].detachFromMember({
      path: { id: memberId, policyId: encodePolicyId(policyId) },
    }),
  );

export const attachPolicyToGroup = async (groupId: string, body: typeof AttachPolicyBody.Type) =>
  runApi((api) =>
    api["policy-attachments"].attachToGroup({ path: { id: groupId }, payload: body }),
  );

export const detachPolicyFromGroup = async (groupId: string, policyId: string) =>
  runApi((api) =>
    api["policy-attachments"].detachFromGroup({
      path: { id: groupId, policyId: encodePolicyId(policyId) },
    }),
  );

export const attachPolicyToRobot = async (robotId: string, body: typeof AttachPolicyBody.Type) =>
  runApi((api) =>
    api["policy-attachments"].attachToRobot({ path: { id: robotId }, payload: body }),
  );

export const detachPolicyFromRobot = async (robotId: string, policyId: string) =>
  runApi((api) =>
    api["policy-attachments"].detachFromRobot({
      path: { id: robotId, policyId: encodePolicyId(policyId) },
    }),
  );
