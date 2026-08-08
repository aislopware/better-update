import { branchesQueryKey, renameBranch } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { toast } from "@better-update/ui/components/toast";
import { Tooltip } from "@better-update/ui/components/tooltip";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { BranchItem } from "@better-update/api-client/react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { BranchNameForm } from "./-branch-name-form";

/**
 * Pass `open`/`onOpenChange` when the dialog is opened from a menu: picking the
 * item unmounts the menu, and an uncontrolled dialog would go with it. Without
 * them the dialog carries its own pencil-button trigger.
 */
export const RenameBranchDialog = ({
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
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setIsOpen = onOpenChange ?? setOwnOpen;
  const [resetKey, setResetKey] = useState(0);
  const queryClient = useQueryClient();
  const renameBranchMutation = useApiMutation({
    mutationFn: async (name: string) => renameBranch(branch.id, { name }),
    onSuccess: async () => {
      toast.success("Branch renamed");
      await queryClient.invalidateQueries({
        queryKey: branchesQueryKey(orgId, projectId),
      });
      setIsOpen(false);
    },
  });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={setIsOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      {open === undefined ? (
        <Tooltip
          content="Rename branch"
          render={
            <DialogTrigger
              render={<Button variant="ghost" shape="square" aria-label="Rename branch" />}
            />
          }
        >
          <PencilSimpleIcon weight="bold" />
        </Tooltip>
      ) : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename branch</DialogTitle>
          <DialogDescription>Change the name of this branch.</DialogDescription>
        </DialogHeader>
        <BranchNameForm
          key={resetKey}
          defaultName={branch.name}
          submitLabel="Rename"
          onSubmit={async (name) => safeSubmit(renameBranchMutation.mutateAsync(name))}
        />
      </DialogContent>
    </Dialog>
  );
};
