import { getApiError } from "@better-update/api-client";
import { renameBranch } from "@better-update/api-client/react";
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
import { Either, Effect } from "effect";
import { useState } from "react";
import { toast } from "sonner";

import type { BranchItem } from "@better-update/api-client/react";

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
            const result = await Effect.runPromise(
              Effect.either(
                Effect.tryPromise({
                  try: async () => renameBranch(branch.id, { name }),
                  catch: (error) => error,
                }),
              ),
            );
            if (Either.isLeft(result)) {
              toast.error(getApiError(result.left));
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
