import { deleteEnvVar } from "@better-update/api-client/react";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { toast } from "@better-update/ui/components/toast";

import type { EnvVar } from "@better-update/api";

import { ConfirmDialog } from "../../../../components/confirm-dialog";
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
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          Delete <InlineCode>{envVar.key}</InlineCode>?
        </>
      }
      description={`This permanently removes the variable and all its revisions in the ${formatEnvironmentLabel(envVar.environment)} environment. This cannot be undone.`}
      confirmLabel="Delete variable"
      isPending={deleteMutation.isPending}
      onConfirm={() => {
        deleteMutation.mutate();
      }}
    />
  );
};
