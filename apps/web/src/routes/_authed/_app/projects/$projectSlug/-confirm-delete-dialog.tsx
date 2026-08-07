import { Button } from "@better-update/ui/components/button";
import { Input } from "@better-update/ui/components/input";
import { toast } from "@better-update/ui/components/toast";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
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
  /** Trigger element wrapped as `DialogTrigger`. Omit when controlling via `open`. */
  readonly children?: ReactElement;
  /** Controlled open state (use with `onOpenChange`). */
  readonly open?: boolean;
  /** Controlled open-change handler (use with `open`). */
  readonly onOpenChange?: (next: boolean) => void;
}

export const ConfirmDeleteDialog = ({
  name,
  title,
  description,
  onConfirm,
  successMessage,
  onSuccess,
  children,
  open: controlledOpen,
  onOpenChange,
}: ConfirmDeleteDialogProps) => {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const open = isControlled ? controlledOpen : internalOpen;

  const deleteMutation = useApiMutation({
    mutationFn: onConfirm,
    onSuccess: async () => {
      toast.success(successMessage);
      await onSuccess?.();
      if (isControlled) {
        onOpenChange?.(false);
      } else {
        setInternalOpen(false);
      }
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (isControlled) {
      onOpenChange?.(nextOpen);
    } else {
      setInternalOpen(nextOpen);
    }
  };

  const handleOpenChangeComplete = (nextOpen: boolean) => {
    if (!nextOpen) {
      setConfirmText("");
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      {children ? <DialogTrigger render={children} /> : null}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          label={
            <>
              Type <span className="font-mono font-bold">{name}</span> to confirm
            </>
          }
          id="confirm-delete"
          value={confirmText}
          onChange={(event) => {
            setConfirmText(event.target.value);
          }}
          placeholder={name}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={confirmText !== name || deleteMutation.isPending}
            onClick={handleDelete}
            loading={deleteMutation.isPending}
          >
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
