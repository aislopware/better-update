import { deleteEnvVar } from "@better-update/api-client/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@better-update/ui/components/ui/alert-dialog";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";

import type { EnvVar } from "@better-update/api";

import { performStepUpGatedWrite } from "../../../../lib/env-vault/step-up";
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
    // Delete is step-up-gated server-side; refresh the step-up from this click if the
    // window lapsed (so the passkey prompt fires inside the gesture) before writing.
    mutationFn: async () => performStepUpGatedWrite(async () => deleteEnvVar(envVar.id)),
    onSuccess: async () => {
      toast.success("Variable deleted");
      await invalidate();
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete <span className="font-mono">{envVar.key}</span>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the variable and all its revisions in the{" "}
            {formatEnvironmentLabel(envVar.environment)} environment. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            {deleteMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
            Delete variable
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
