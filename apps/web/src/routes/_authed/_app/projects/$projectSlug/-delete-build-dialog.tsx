import { deleteBuild } from "@better-update/api-client/react";
import { useQueryClient } from "@tanstack/react-query";

import type { BuildWithArtifact } from "@better-update/api";

import { ConfirmDeleteDialog, deleteIconTrigger } from "./-confirm-delete-dialog";
import { invalidateBuilds } from "./-update-helpers";

/**
 * Pass `open`/`onOpenChange` when the dialog is opened from a menu: picking the
 * item unmounts the menu, and an uncontrolled dialog would go with it. Without
 * them the dialog carries its own trash-button trigger.
 */
export const DeleteBuildDialog = ({
  build,
  orgId,
  projectId,
  open,
  onOpenChange,
}: {
  build: BuildWithArtifact;
  orgId: string;
  projectId: string;
  open?: boolean | undefined;
  onOpenChange?: ((next: boolean) => void) | undefined;
}) => {
  const queryClient = useQueryClient();

  return (
    <ConfirmDeleteDialog
      name={build.message ?? build.id.slice(0, 8)}
      title="Delete build?"
      description="This action cannot be undone. The build and its artifact will be permanently deleted."
      onConfirm={async () => deleteBuild(build.id)}
      successMessage="Build deleted"
      onSuccess={async () => {
        await invalidateBuilds(queryClient, orgId, projectId);
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      {open === undefined ? deleteIconTrigger("Delete build") : undefined}
    </ConfirmDeleteDialog>
  );
};
