import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { apiPost, getResponseError } from "../../../../../lib/api-client";
import { BranchNameForm } from "./-branch-name-form";

export const CreateBranchDialog = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
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
          submitIcon={Add01Icon}
          onSubmit={async (name) => {
            const response = await apiPost("/api/branches", { projectId, name });

            if (!response.ok) {
              toast.error(await getResponseError(response));
              return;
            }

            toast.success("Branch created");
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
