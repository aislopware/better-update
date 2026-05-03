import { branchesQueryKey, renameBranch } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

import type { BranchItem } from "@better-update/api-client/react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { BranchNameForm } from "./-branch-name-form";

const renameTrigger = (
  <Button variant="ghost" size="icon">
    <PencilIcon strokeWidth={2} />
  </Button>
);

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
      toastManager.add({ title: "Branch renamed", type: "success" });
      await queryClient.invalidateQueries({
        queryKey: branchesQueryKey(orgId, projectId),
      });
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={renameTrigger} />
      <DialogPopup>
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
      </DialogPopup>
    </Dialog>
  );
};
