import { policiesQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { LockIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { AttachPolicyBody } from "@better-update/api";
import type { PolicyAttachmentItem, PolicyItem } from "@better-update/api-client/react";
import type { QueryKey } from "@tanstack/react-query";

import { useApiMutation } from "../../../lib/use-api-mutation";

const isManagedPolicyId = (policyId: string): boolean => policyId.startsWith("managed:");

export interface PolicyAttachPanelProps {
  readonly orgId: string;
  readonly attachments: readonly PolicyAttachmentItem[];
  readonly isLoading: boolean;
  readonly attachmentsQueryKey: QueryKey;
  readonly onAttach: (body: typeof AttachPolicyBody.Type) => Promise<unknown>;
  readonly onDetach: (policyId: string) => Promise<unknown>;
}

const policyLabel = (policies: readonly PolicyItem[], policyId: string): string => {
  const match = policies.find((policy) => policy.id === policyId);
  return match?.name ?? policyId;
};

const AttachmentList = ({
  attachments,
  isLoading,
  policies,
  detachingPolicyId,
  onDetach,
}: {
  attachments: readonly PolicyAttachmentItem[];
  isLoading: boolean;
  policies: readonly PolicyItem[];
  detachingPolicyId: string | undefined;
  onDetach: (policyId: string) => void;
}) => {
  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
        <Spinner />
        Loading attachments…
      </div>
    );
  }
  if (attachments.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm">No policies attached yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="border-border flex items-center justify-between rounded-md border px-3 py-2"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            {policyLabel(policies, attachment.policyId)}
            {isManagedPolicyId(attachment.policyId) ? (
              <Badge variant="secondary" className="gap-1">
                <LockIcon className="size-3" strokeWidth={2} />
                Managed
              </Badge>
            ) : null}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Detach policy"
            loading={detachingPolicyId === attachment.policyId}
            onClick={() => {
              onDetach(attachment.policyId);
            }}
          >
            <XIcon className="size-4" strokeWidth={2} />
          </Button>
        </li>
      ))}
    </ul>
  );
};

export const PolicyAttachPanel = ({
  orgId,
  attachments,
  isLoading,
  attachmentsQueryKey,
  onAttach,
  onDetach,
}: PolicyAttachPanelProps) => {
  const queryClient = useQueryClient();
  const [selectedPolicyId, setSelectedPolicyId] = useState("");

  const { data: policiesData } = useSuspenseQuery(policiesQueryOptions(orgId));
  const policies = policiesData.items;

  const attachedIds = useMemo(
    () => new Set(attachments.map((attachment) => attachment.policyId)),
    [attachments],
  );
  const availablePolicies = useMemo(
    () => policies.filter((policy) => !attachedIds.has(policy.id)),
    [policies, attachedIds],
  );

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: attachmentsQueryKey });
  };

  const attachMutation = useApiMutation({
    mutationFn: async (policyId: string) => onAttach({ policyId }),
    onSuccess: async () => {
      toastManager.add({ title: "Policy attached", type: "success" });
      setSelectedPolicyId("");
      await invalidate();
    },
  });

  const detachMutation = useApiMutation({
    mutationFn: async (policyId: string) => onDetach(policyId),
    onSuccess: async () => {
      toastManager.add({ title: "Policy detached", type: "success" });
      await invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Select
            value={selectedPolicyId}
            onValueChange={(next) => {
              if (next !== null) {
                setSelectedPolicyId(next);
              }
            }}
            disabled={availablePolicies.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a policy to attach" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {availablePolicies.map((policy) => (
                  <SelectItem key={policy.id} value={policy.id}>
                    {policy.name}
                    {isManagedPolicyId(policy.id) ? " (managed)" : ""}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>
        <Button
          loading={attachMutation.isPending}
          disabled={selectedPolicyId === ""}
          onClick={() => {
            if (selectedPolicyId !== "") {
              attachMutation.mutate(selectedPolicyId);
            }
          }}
        >
          Attach
        </Button>
      </div>

      <AttachmentList
        attachments={attachments}
        isLoading={isLoading}
        policies={policies}
        detachingPolicyId={detachMutation.isPending ? detachMutation.variables : undefined}
        onDetach={(policyId) => {
          detachMutation.mutate(policyId);
        }}
      />
    </div>
  );
};
