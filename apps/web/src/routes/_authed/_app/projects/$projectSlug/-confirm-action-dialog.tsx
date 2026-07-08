import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@better-update/ui/components/ui/alert-dialog";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useState } from "react";

import type { Button } from "@better-update/ui/components/ui/button";
import type { ComponentProps, ReactElement } from "react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";

interface ConfirmActionDialogProps {
  /** Dialog title (e.g. "Archive my-app?"). */
  readonly title: string;
  /** Explanation shown below the title. */
  readonly description: string;
  /** Label for the confirm button. */
  readonly confirmLabel: string;
  /** Confirm button variant — defaults to the primary action style. */
  readonly confirmVariant?: ComponentProps<typeof Button>["variant"];
  /** Async action handler — should throw on API error. */
  readonly onConfirm: () => Promise<unknown>;
  /** Toast message shown on success. */
  readonly successMessage: string;
  /** Post-action cleanup (query invalidation, navigation, etc.). */
  readonly onSuccess?: () => Promise<void>;
  /** Trigger element wrapped as `AlertDialogTrigger`. */
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
      toast.success(successMessage);
      await onSuccess?.();
      setOpen(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={children} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={confirmVariant}
            disabled={mutation.isPending}
            onClick={() => {
              mutation.mutate();
            }}
          >
            {mutation.isPending && <Spinner data-icon="inline-start" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
