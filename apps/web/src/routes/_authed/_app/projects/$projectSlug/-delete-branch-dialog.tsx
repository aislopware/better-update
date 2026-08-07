import { deleteBranch } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";

import type { BranchItem } from "@better-update/api-client/react";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
import { invalidateBranches } from "./-update-helpers";

export const DeleteBranchDialog = ({
  branch,
  orgId,
  projectId,
}: {
  branch: BranchItem;
  orgId: string;
  projectId: string;
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
    >
      <Button
        variant="ghost"
        shape="square"
        className="text-muted-foreground/70 hover:text-destructive size-8"
        aria-label="Delete branch"
      >
        <TrashIcon weight="bold" className="size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
