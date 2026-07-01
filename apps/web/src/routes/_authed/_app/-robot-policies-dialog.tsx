import {
  attachPolicyToRobot,
  detachPolicyFromRobot,
  robotPoliciesQueryKey,
  robotPoliciesQueryOptions,
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

const RobotPoliciesContent = ({ orgId, robotId }: { orgId: string; robotId: string }) => {
  const { data, isLoading } = useQuery(robotPoliciesQueryOptions(orgId, robotId));
  return (
    <PolicyAttachPanel
      orgId={orgId}
      attachments={data?.items ?? []}
      isLoading={isLoading}
      attachmentsQueryKey={robotPoliciesQueryKey(orgId, robotId)}
      onAttach={async (body) => attachPolicyToRobot(robotId, body)}
      onDetach={async (policyId) => detachPolicyFromRobot(robotId, policyId)}
    />
  );
};

export const RobotPoliciesDialog = ({
  orgId,
  robotId,
  robotName,
  open,
  onOpenChange,
}: {
  orgId: string;
  robotId: string;
  robotName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Policies for {robotName}</DialogTitle>
        <DialogDescription>
          A freshly minted robot account holds no permissions (default-deny) — attach a policy so it
          can call the management API.
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
          <RobotPoliciesContent orgId={orgId} robotId={robotId} />
        </Suspense>
      </DialogPanel>
    </DialogPopup>
  </Dialog>
);
