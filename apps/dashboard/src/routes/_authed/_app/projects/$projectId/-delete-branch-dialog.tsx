import { deleteBranch } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";

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
      <Button variant="ghost" size="icon" className="size-8">
        <Trash2Icon strokeWidth={2} className="text-destructive size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
