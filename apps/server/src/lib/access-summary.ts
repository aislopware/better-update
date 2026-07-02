// Pure assembly of per-member access summaries from the org's members, group
// memberships, and policy attachments. No I/O — the members handler feeds it
// three small org-scoped reads. With managed policies reduced to
// `managed:admin`, a summary is just the org role plus the custom-policy count.

import { groupBy } from "es-toolkit";

import { ADMIN_POLICY_ID } from "../auth/managed-policies";

import type { PolicyAttachmentModel } from "../models";

export interface AccessSummaryMemberInput {
  readonly id: string;
  readonly isOwner: boolean;
}

export interface AccessSummaryMembershipInput {
  readonly groupId: string;
  readonly memberId: string;
}

export interface MemberAccessSummaryModel {
  readonly memberId: string;
  readonly orgRole: "owner" | "admin" | "member";
  readonly adminViaGroup: boolean;
  /** Attached real (non-managed) policies, direct + via groups. */
  readonly customPolicyCount: number;
}

interface GrantRef {
  readonly policyId: string;
  readonly viaGroup: boolean;
}

const summarizeMember = (params: {
  readonly memberId: string;
  readonly isOwner: boolean;
  readonly grants: readonly GrantRef[];
}): MemberAccessSummaryModel => {
  // Direct grants first so a duplicate (direct + via group) keeps viaGroup=false.
  const ordered = params.grants.toSorted(
    (left, right) => Number(left.viaGroup) - Number(right.viaGroup),
  );
  const adminGrant = ordered.find((grant) => grant.policyId === ADMIN_POLICY_ID);
  const customPolicyCount = new Set(
    ordered.filter((grant) => grant.policyId !== ADMIN_POLICY_ID).map((grant) => grant.policyId),
  ).size;

  if (params.isOwner) {
    return { memberId: params.memberId, orgRole: "owner", adminViaGroup: false, customPolicyCount };
  }
  return {
    memberId: params.memberId,
    orgRole: adminGrant === undefined ? "member" : "admin",
    adminViaGroup: adminGrant?.viaGroup ?? false,
    customPolicyCount,
  };
};

export const computeAccessSummaries = (params: {
  readonly members: readonly AccessSummaryMemberInput[];
  readonly memberships: readonly AccessSummaryMembershipInput[];
  readonly attachments: readonly PolicyAttachmentModel[];
}): readonly MemberAccessSummaryModel[] => {
  const byMember = groupBy(
    params.attachments.filter((attachment) => attachment.principalType === "member"),
    (attachment) => attachment.principalId,
  );
  const byGroup = groupBy(
    params.attachments.filter((attachment) => attachment.principalType === "group"),
    (attachment) => attachment.principalId,
  );
  const groupsOfMember = groupBy(params.memberships, (membership) => membership.memberId);

  return params.members.map((member) => {
    const direct = (byMember[member.id] ?? []).map((attachment) => ({
      policyId: attachment.policyId,
      viaGroup: false,
    }));
    const viaGroups = (groupsOfMember[member.id] ?? []).flatMap((membership) =>
      (byGroup[membership.groupId] ?? []).map((attachment) => ({
        policyId: attachment.policyId,
        viaGroup: true,
      })),
    );
    return summarizeMember({
      memberId: member.id,
      isOwner: member.isOwner,
      grants: [...direct, ...viaGroups],
    });
  });
};
