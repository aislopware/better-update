import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { Input } from "@better-update/ui/components/input";
import { toast } from "@better-update/ui/components/toast";
import { useState } from "react";

import type { ReactElement } from "react";

import { CopyChip } from "../../../../../lib/copy-button";
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
  readonly children?: ReactElement | undefined;
  /** Controlled open state (use with `onOpenChange`). */
  readonly open?: boolean | undefined;
  /** Controlled open-change handler (use with `open`). */
  readonly onOpenChange?: ((next: boolean) => void) | undefined;
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
    // `alertdialog`, as every other confirmation here: a click landing outside
    // must not throw away a half-typed name and the intent behind it.
    <Dialog
      role="alertdialog"
      open={open}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={handleOpenChangeComplete}
    >
      {children ? <DialogTrigger render={children} /> : null}
      <DialogContent>
        <DialogHeader showCloseButton={false}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {/* The prompt is a sibling of the field, not its label: the name is a
              button, and interactive content inside a label makes the click
              target ambiguous. */}
          <p className="flex flex-wrap items-center gap-1.5">
            Type <CopyChip value={name} /> to confirm
          </p>
          <Input
            aria-label={`Type ${name} to confirm deletion`}
            value={confirmText}
            onChange={(event) => {
              setConfirmText(event.target.value);
            }}
            placeholder={name}
            // A name typed to authorise destruction must be the name, not what
            // the browser guessed from a past form or corrected on the way in.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
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
