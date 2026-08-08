import { deleteBranch } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";

import type { BranchItem } from "@better-update/api-client/react";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
import { invalidateBranches } from "./-update-helpers";

/**
 * Pass `open`/`onOpenChange` when the dialog is opened from a menu: picking the
 * item unmounts the menu, and an uncontrolled dialog would go with it. Without
 * them the dialog carries its own trash-button trigger.
 */
export const DeleteBranchDialog = ({
  branch,
  orgId,
  projectId,
  open,
  onOpenChange,
}: {
  branch: BranchItem;
  orgId: string;
  projectId: string;
  open?: boolean | undefined;
  onOpenChange?: ((next: boolean) => void) | undefined;
}) => {
  const queryClient = useQueryClient();

  return (
    <ConfirmDeleteDialog
      name={branch.name}
      title={`Delete ${branch.name}?`}
      description="This action cannot be undone. All updates on this branch will be permanently removed. Channels linked to this branch must be relinked first."
      onConfirm={async () => deleteBranch(branch.id)}
      successMessage="Branch deleted"
      onSuccess={async () => {
        await invalidateBranches(queryClient, orgId, projectId);
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      {open === undefined ? (
        <Button
          variant="ghost"
          shape="square"
          className="text-kumo-subtle/70 hover:text-kumo-danger size-8"
          aria-label="Delete branch"
        >
          <TrashIcon weight="bold" className="size-4" />
        </Button>
      ) : undefined}
    </ConfirmDeleteDialog>
  );
};
