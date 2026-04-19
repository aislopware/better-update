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
import { useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="ghost" size="icon" className="size-8">
          <PencilIcon strokeWidth={2} className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename branch</DialogTitle>
          <DialogDescription>Change the name of this branch.</DialogDescription>
        </DialogHeader>
        <BranchNameForm
          defaultName={branch.name}
          submitLabel="Rename"
          submittingLabel="Renaming..."
          onSubmit={async (name) => safeSubmit(renameBranchMutation.mutateAsync(name))}
        />
      </DialogContent>
    </Dialog>
  );
};
