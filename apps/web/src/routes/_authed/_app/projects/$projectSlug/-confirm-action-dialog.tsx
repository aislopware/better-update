import { toast } from "@better-update/ui/components/toast";
import { useState } from "react";

import type { ButtonProps } from "@better-update/ui/components/button";
import type { ReactElement } from "react";

import { ConfirmDialog } from "../../../../../components/confirm-dialog";
import { useApiMutation } from "../../../../../lib/use-api-mutation";

interface ConfirmActionDialogProps {
  /** Dialog title (e.g. "Archive my-app?"). */
  readonly title: string;
  /** Explanation shown below the title. */
  readonly description: string;
  /** Label for the confirm button. */
  readonly confirmLabel: string;
  /** Confirm button variant — defaults to the primary action style. */
  readonly confirmVariant?: ButtonProps["variant"];
  /** Async action handler — should throw on API error. */
  readonly onConfirm: () => Promise<unknown>;
  /** Toast message shown on success. */
  readonly successMessage: string;
  /** Post-action cleanup (query invalidation, navigation, etc.). */
  readonly onSuccess?: () => Promise<void>;
  /** Trigger element that opens the dialog. */
  readonly children: ReactElement;
}

/**
 * A lightweight confirm dialog for reversible / lower-risk actions (archive,
 * restore). Unlike {@link ConfirmDeleteDialog} it does not require typing the
 * entity name — use that one for irreversible destruction.
 *
 * Adds the mutation, the success toast and the self-closing to the plain
 * {@link ConfirmDialog}, so callers hand it an action rather than wiring state.
 */
export const ConfirmActionDialog = ({
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  onConfirm,
  successMessage,
  onSuccess,
  children,
}: ConfirmActionDialogProps) => {
  const [open, setOpen] = useState(false);

  const mutation = useApiMutation({
    mutationFn: onConfirm,
    onSuccess: async () => {
      toast.success(successMessage);
      await onSuccess?.();
      setOpen(false);
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={children}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      confirmVariant={confirmVariant}
      isPending={mutation.isPending}
      onConfirm={() => {
        mutation.mutate();
      }}
    />
  );
};
