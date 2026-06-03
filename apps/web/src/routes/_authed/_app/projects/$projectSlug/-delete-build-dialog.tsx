import { deleteBuild } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";

import type { BuildWithArtifact } from "@better-update/api";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
import { invalidateBuilds } from "./-update-helpers";

export const DeleteBuildDialog = ({
  build,
  orgId,
  projectId,
}: {
  build: BuildWithArtifact;
  orgId: string;
  projectId: string;
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
    >
      <Button variant="ghost" size="icon" className="size-8" aria-label="Delete build">
        <Trash2Icon strokeWidth={2} className="text-destructive size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
