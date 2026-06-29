import { deleteEnvVar } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";

import type { EnvVar } from "@better-update/api";

import { useApiMutation } from "../../../../lib/use-api-mutation";
import { formatEnvironmentLabel } from "./-env-vars-labels";

/**
 * Delete one env var and all its revisions. The server re-gates the delete on a
 * passkey step-up. Controlled by the row's action menu.
 */
export const EnvVarDeleteDialog = ({
  envVar,
  invalidate,
  open,
  onOpenChange,
}: {
  envVar: EnvVar;
  invalidate: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const deleteMutation = useApiMutation({
    mutationFn: async () => deleteEnvVar(envVar.id),
    onSuccess: async () => {
      toastManager.add({ title: "Variable deleted", type: "success" });
      await invalidate();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            Delete <span className="font-mono">{envVar.key}</span>?
          </DialogTitle>
          <DialogDescription>
            This permanently removes the variable and all its revisions in the{" "}
            {formatEnvironmentLabel(envVar.environment)} environment. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            Delete variable
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
