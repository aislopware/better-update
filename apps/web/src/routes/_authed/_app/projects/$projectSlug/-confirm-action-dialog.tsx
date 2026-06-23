import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useState } from "react";

import type { ButtonProps } from "@better-update/ui/components/ui/button";
import type { ReactElement } from "react";

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
  /** Trigger element wrapped as `DialogTrigger`. */
  readonly children: ReactElement;
}

/**
 * A lightweight confirm dialog for reversible / lower-risk actions (archive,
 * restore). Unlike {@link ConfirmDeleteDialog} it does not require typing the
 * entity name — use that one for irreversible destruction.
 */
export const ConfirmActionDialog = ({
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  onConfirm,
  successMessage,
  onSuccess,
  children,
}: ConfirmActionDialogProps) => {
  const [open, setOpen] = useState(false);

  const mutation = useApiMutation({
    mutationFn: onConfirm,
    onSuccess: async () => {
      toastManager.add({ title: successMessage, type: "success" });
      await onSuccess?.();
      setOpen(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant={confirmVariant}
            loading={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
