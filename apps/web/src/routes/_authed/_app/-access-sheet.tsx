import { Button } from "@better-update/ui/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@better-update/ui/components/ui/collapsible";
import { Label } from "@better-update/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
import { Separator } from "@better-update/ui/components/ui/separator";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@better-update/ui/components/ui/sheet";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { Suspense } from "react";

import type { AttachPolicyBody } from "@better-update/api";
import type { PolicyAttachmentItem } from "@better-update/api-client/react";
import type { QueryKey } from "@tanstack/react-query";

import { ADMIN_POLICY_ID, isManagedPolicy } from "../../../lib/policy";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { PolicyAttachPanel } from "./-policy-attach-panel";

export interface AccessSheetProps {
  readonly orgId: string;
  readonly principalLabel: string;
  readonly attachments: readonly PolicyAttachmentItem[];
  readonly isLoading: boolean;
  readonly attachmentsQueryKey: QueryKey;
  readonly onAttach: (body: typeof AttachPolicyBody.Type) => Promise<unknown>;
  readonly onDetach: (policyId: string) => Promise<unknown>;
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

const OrgRoleSection = ({
  isAdmin,
  isMutating,
  onChange,
}: {
  isAdmin: boolean;
  isMutating: boolean;
  onChange: (nextAdmin: boolean) => void;
}) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-sm font-medium">Organization role</h3>
    <RadioGroup
      value={isAdmin ? "admin" : "member"}
      onValueChange={(next) => {
        if (next !== null && (next === "admin") !== isAdmin) {
          onChange(next === "admin");
        }
      }}
      disabled={isMutating}
      className="flex flex-col gap-2"
    >
      <Label className="flex items-start gap-2.5 font-normal">
        <RadioGroupItem value="member" className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Member</span>
          <span className="text-muted-foreground text-xs">
            Baseline access only — grant additional access via custom policies below.
          </span>
        </span>
      </Label>
      <Label className="flex items-start gap-2.5 font-normal">
        <RadioGroupItem value="admin" className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Admin</span>
          <span className="text-muted-foreground text-xs">
            Full organization administration: members, access control, projects, credentials,
            billing.
          </span>
        </span>
      </Label>
    </RadioGroup>
  </section>
);

const AccessSheetContent = ({
  orgId,
  attachments,
  isLoading,
  attachmentsQueryKey,
  onAttach,
  onDetach,
}: Omit<AccessSheetProps, "open" | "onOpenChange" | "principalLabel">) => {
  const queryClient = useQueryClient();

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: attachmentsQueryKey });
    await queryClient.invalidateQueries({ queryKey: ["org", orgId, "member-access-summaries"] });
  };

  const attachMutation = useApiMutation({
    mutationFn: async (policyId: string) => onAttach({ policyId }),
    onSuccess: async () => {
      toastManager.add({ title: "Access updated", type: "success" });
      await invalidate();
    },
  });
  const detachMutation = useApiMutation({
    mutationFn: async (policyId: string) => onDetach(policyId),
    onSuccess: async () => {
      toastManager.add({ title: "Access updated", type: "success" });
      await invalidate();
    },
  });
  const isMutating = attachMutation.isPending || detachMutation.isPending;

  const isAdmin = attachments.some((attachment) => attachment.policyId === ADMIN_POLICY_ID);
  const customAttachments = attachments.filter(
    (attachment) => !isManagedPolicy(attachment.policyId),
  );

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
        <Spinner />
        Loading access…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <OrgRoleSection
        isAdmin={isAdmin}
        isMutating={isMutating}
        onChange={(nextAdmin) => {
          if (nextAdmin) {
            attachMutation.mutate(ADMIN_POLICY_ID);
          } else {
            detachMutation.mutate(ADMIN_POLICY_ID);
          }
        }}
      />
      <Separator />
      <Collapsible defaultOpen>
        <CollapsibleTrigger
          render={
            <Button variant="ghost" size="sm" className="text-muted-foreground -ml-2 gap-1" />
          }
        >
          <ChevronDownIcon
            className="size-4 transition-transform duration-150 in-data-open:rotate-180"
            strokeWidth={2}
          />
          Custom policies
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="pt-3">
            <PolicyAttachPanel
              orgId={orgId}
              attachments={customAttachments}
              isLoading={false}
              attachmentsQueryKey={attachmentsQueryKey}
              customOnly
              onAttach={onAttach}
              onDetach={onDetach}
            />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
};

export const AccessSheet = ({
  orgId,
  principalLabel,
  attachments,
  isLoading,
  attachmentsQueryKey,
  onAttach,
  onDetach,
  open,
  onOpenChange,
}: AccessSheetProps) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetPopup className="sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Access for {principalLabel}</SheetTitle>
        <SheetDescription>
          Organization role plus custom policies. Group-conferred access is managed on the Groups
          page.
        </SheetDescription>
      </SheetHeader>
      <SheetPanel>
        <Suspense
          fallback={
            <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
              <Spinner />
              Loading…
            </div>
          }
        >
          <AccessSheetContent
            orgId={orgId}
            attachments={attachments}
            isLoading={isLoading}
            attachmentsQueryKey={attachmentsQueryKey}
            onAttach={onAttach}
            onDetach={onDetach}
          />
        </Suspense>
      </SheetPanel>
    </SheetPopup>
  </Sheet>
);
