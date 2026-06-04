import {
  attachPolicyToMember,
  detachPolicyFromMember,
  memberPoliciesQueryKey,
  memberPoliciesQueryOptions,
} from "@better-update/api-client/react";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";

import { PolicyAttachPanel } from "./-policy-attach-panel";

const MemberPoliciesContent = ({ orgId, memberId }: { orgId: string; memberId: string }) => {
  const { data, isLoading } = useQuery(memberPoliciesQueryOptions(orgId, memberId));
  return (
    <PolicyAttachPanel
      orgId={orgId}
      attachments={data?.items ?? []}
      isLoading={isLoading}
      attachmentsQueryKey={memberPoliciesQueryKey(orgId, memberId)}
      onAttach={async (body) => attachPolicyToMember(memberId, body)}
      onDetach={async (policyId) => detachPolicyFromMember(memberId, policyId)}
    />
  );
};

export const MemberPoliciesDialog = ({
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
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Policies for {memberName}</DialogTitle>
        <DialogDescription>
          Attach policies directly to this member, in addition to any inherited from groups.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <Suspense
          fallback={
            <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
              <Spinner />
              Loading…
            </div>
          }
        >
          <MemberPoliciesContent orgId={orgId} memberId={memberId} />
        </Suspense>
      </DialogPanel>
    </DialogPopup>
  </Dialog>
);
