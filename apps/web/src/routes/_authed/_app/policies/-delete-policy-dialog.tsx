import { deletePolicy, policiesQueryKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";

import type { PolicyItem } from "@better-update/api-client/react";

import { useApiMutation } from "../../../../lib/use-api-mutation";

export const DeletePolicyDialog = ({
  orgId,
  policy,
  open,
  onOpenChange,
}: {
  orgId: string;
  policy: PolicyItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const queryClient = useQueryClient();

  const deleteMutation = useApiMutation({
    mutationFn: async () => deletePolicy(policy.id),
    onSuccess: async () => {
      toastManager.add({ title: "Policy deleted", type: "success" });
      await queryClient.invalidateQueries({ queryKey: policiesQueryKey(orgId) });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Delete policy?</DialogTitle>
          <DialogDescription>
            <strong className="font-semibold">{policy.name}</strong> will be removed and detached
            from every member, group, and API key it is attached to. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            Delete policy
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
