import {
  attachPolicyToMember,
  detachPolicyFromMember,
  memberPoliciesQueryKey,
  memberPoliciesQueryOptions,
} from "@better-update/api-client/react";
import { useQuery } from "@tanstack/react-query";

import { AccessSheet } from "./-access-sheet";

// The Members page's access-control surface: org role (Member/Admin) + custom
// policies, all as direct attachments on the member. Group-conferred access
// lives on Groups.
export const MemberAccessSheet = ({
  orgId,
  memberId,
  memberName,
  open,
  onOpenChange,
}: {
  orgId: string;
  memberId: string;
  memberName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const { data, isLoading } = useQuery({
    ...memberPoliciesQueryOptions(orgId, memberId),
    enabled: open,
  });
  return (
    <AccessSheet
      orgId={orgId}
      principalLabel={memberName}
      attachments={data?.items ?? []}
      isLoading={isLoading}
      attachmentsQueryKey={memberPoliciesQueryKey(orgId, memberId)}
      onAttach={async (body) => attachPolicyToMember(memberId, body)}
      onDetach={async (policyId) => detachPolicyFromMember(memberId, policyId)}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
};
