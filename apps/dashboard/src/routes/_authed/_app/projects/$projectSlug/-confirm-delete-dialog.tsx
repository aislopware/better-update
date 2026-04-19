import { Button } from "@better-update/ui/components/ui/button";
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
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";

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
      toast.success(successMessage);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-4">
          <Label htmlFor="confirm-delete">
            Type <span className="font-mono font-bold">{name}</span> to confirm
          </Label>
          <Input
            id="confirm-delete"
            value={confirmText}
            onChange={(event) => {
              setConfirmText(event.target.value);
            }}
            placeholder={name}
          />
        </div>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={confirmText !== name || deleteMutation.isPending}
            onClick={handleDelete}
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
