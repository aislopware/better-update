import {
  apiKeyPoliciesQueryKey,
  apiKeyPoliciesQueryOptions,
  attachPolicyToApiKey,
  detachPolicyFromApiKey,
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

const ApiKeyPoliciesContent = ({ orgId, apiKeyId }: { orgId: string; apiKeyId: string }) => {
  const { data, isLoading } = useQuery(apiKeyPoliciesQueryOptions(orgId, apiKeyId));
  return (
    <PolicyAttachPanel
      orgId={orgId}
      attachments={data?.items ?? []}
      isLoading={isLoading}
      attachmentsQueryKey={apiKeyPoliciesQueryKey(orgId, apiKeyId)}
      onAttach={async (body) => attachPolicyToApiKey(apiKeyId, body)}
      onDetach={async (policyId) => detachPolicyFromApiKey(apiKeyId, policyId)}
    />
  );
};

export const ApiKeyPoliciesDialog = ({
  orgId,
  apiKeyId,
  apiKeyName,
  open,
  onOpenChange,
}: {
  orgId: string;
  apiKeyId: string;
  apiKeyName: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Policies for {apiKeyName}</DialogTitle>
        <DialogDescription>
          Attach policies to scope what this key can do. A key with no policies has no access.
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
          <ApiKeyPoliciesContent orgId={orgId} apiKeyId={apiKeyId} />
        </Suspense>
      </DialogPanel>
    </DialogPopup>
  </Dialog>
);
