import { branchesQueryKey, createBranch } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { BranchNameForm } from "./-branch-name-form";

export const CreateBranchDialog = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
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
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} className="size-4" />
        Create branch
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a branch</DialogTitle>
          <DialogDescription>Create a new branch within this project.</DialogDescription>
        </DialogHeader>
        <BranchNameForm
          defaultName=""
          submitLabel="Create branch"
          submittingLabel="Creating..."
          submitIcon={PlusIcon}
          onSubmit={async (name) => safeSubmit(createBranchMutation.mutateAsync(name))}
        />
      </DialogContent>
    </Dialog>
  );
};
