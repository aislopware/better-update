import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useState } from "react";

import type { ReactElement } from "react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";

interface ConfirmDeleteDialogProps {
  /** Entity name the user must type to confirm. */
  readonly name: string;
  /** Dialog title (e.g. "Delete main?"). */
  readonly title: string;
  /** Explanation shown below the title. */
  readonly description: string;
  /** Async delete handler — should throw on API error. */
  readonly onConfirm: () => Promise<unknown>;
  /** Toast message shown on success. */
  readonly successMessage: string;
  /** Post-delete cleanup (query invalidation, navigation, etc.). */
  readonly onSuccess?: () => Promise<void>;
  /** Trigger element (e.g. icon button or text button). */
  readonly children: ReactElement;
}

export const ConfirmDeleteDialog = ({
  name,
  title,
  description,
  onConfirm,
  successMessage,
  onSuccess,
  children,
}: ConfirmDeleteDialogProps) => {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const deleteMutation = useApiMutation({
    mutationFn: onConfirm,
    onSuccess: async () => {
      toastManager.add({ title: successMessage, type: "success" });
      await onSuccess?.();
      setOpen(false);
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setConfirmText("");
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={children} />
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Field>
            <FieldLabel htmlFor="confirm-delete">
              Type <span className="font-mono font-bold">{name}</span> to confirm
            </FieldLabel>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(event) => {
                setConfirmText(event.target.value);
              }}
              placeholder={name}
            />
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={confirmText !== name || deleteMutation.isPending}
            onClick={handleDelete}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
