import {
  branchesQueryKey,
  buildCompatibilityMatrixQueryKey,
  channelsQueryKey,
  deleteBranch,
  updatesQueryKey,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";

import type { BranchItem } from "@better-update/api-client/react";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";

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
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: branchesQueryKey(orgId, projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: channelsQueryKey(orgId, projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: updatesQueryKey(orgId, projectId),
          }),
          queryClient.invalidateQueries({
            queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
          }),
        ]);
      }}
    >
      <Button variant="ghost" size="icon" className="size-8">
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="text-destructive size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
