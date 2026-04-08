import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { apiPatch, getResponseError } from "../../../../../lib/api-client";
import { BranchNameForm } from "./-branch-name-form";

import type { BranchItem } from "../../../../../queries/branches";

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="ghost" size="icon" className="size-8">
          <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} className="size-4" />
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
          onSubmit={async (name) => {
            const response = await apiPatch(`/api/branches/${branch.id}`, { name });

            if (!response.ok) {
              toast.error(await getResponseError(response));
              return;
            }

            toast.success("Branch renamed");
            await queryClient.invalidateQueries({
              queryKey: ["org", orgId, "projects", projectId, "branches"],
            });
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
