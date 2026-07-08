import { branchesQueryKey, renameBranch } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

import type { BranchItem } from "@better-update/api-client/react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { BranchNameForm } from "./-branch-name-form";

export const RenameBranchDialog = ({
  branch,
  orgId,
  projectId,
}: {
  branch: BranchItem;
  orgId: string;
  projectId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const queryClient = useQueryClient();
  const renameBranchMutation = useApiMutation({
    mutationFn: async (name: string) => renameBranch(branch.id, { name }),
    onSuccess: async () => {
      toast.success("Branch renamed");
      await queryClient.invalidateQueries({
        queryKey: branchesQueryKey(orgId, projectId),
      });
      setOpen(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={<Button variant="ghost" size="icon" aria-label="Rename branch" />}
            />
          }
        >
          <PencilIcon strokeWidth={2} />
        </TooltipTrigger>
        <TooltipContent>Rename branch</TooltipContent>
      </Tooltip>
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
