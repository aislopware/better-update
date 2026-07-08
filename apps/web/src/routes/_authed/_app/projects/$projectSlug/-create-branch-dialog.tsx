import { branchesQueryKey, createBranch } from "@better-update/api-client/react";
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
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { BranchNameForm } from "./-branch-name-form";

export const CreateBranchDialog = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const queryClient = useQueryClient();
  const createBranchMutation = useApiMutation({
    mutationFn: async (name: string) => createBranch({ projectId, name }),
    onSuccess: async () => {
      toast.success("Branch created");
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
      <DialogTrigger render={<Button />}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Create branch
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a branch</DialogTitle>
          <DialogDescription>Create a new branch within this project.</DialogDescription>
        </DialogHeader>
        <BranchNameForm
          key={resetKey}
          defaultName=""
          submitLabel="Create branch"
          submitIcon={PlusIcon}
          onSubmit={async (name) => safeSubmit(createBranchMutation.mutateAsync(name))}
        />
      </DialogContent>
    </Dialog>
  );
};
