import {
  buildCompatibilityMatrixQueryKey,
  buildsQueryKey,
  deleteBuild,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import type { BuildWithArtifact } from "@better-update/api";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";

export const DeleteBuildDialog = ({
  build,
  orgId,
  projectId,
}: {
  build: typeof BuildWithArtifact.Type;
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
        await Effect.runPromise(
          Effect.asVoid(
            Effect.all(
              [
                Effect.promise(async () =>
                  queryClient.invalidateQueries({
                    queryKey: buildsQueryKey(orgId, projectId),
                  }),
                ),
                Effect.promise(async () =>
                  queryClient.invalidateQueries({
                    queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
                  }),
                ),
              ],
              { concurrency: "unbounded" },
            ),
          ),
        );
      }}
    >
      <Button variant="ghost" size="icon" className="size-8" title="Delete build">
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="text-destructive size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
