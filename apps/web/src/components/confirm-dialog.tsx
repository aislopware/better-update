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

import type { ButtonProps } from "@better-update/ui/components/button";
import type { ReactElement, ReactNode } from "react";

interface ConfirmDialogProps {
  /** Controlled open state. */
  readonly open: boolean;
  /** Controlled open-change handler. */
  readonly onOpenChange: (next: boolean) => void;
  /** Question the dialog asks (e.g. "Remove device?"). */
  readonly title: ReactNode;
  /** What confirming will do, and whether it can be undone. */
  readonly description: ReactNode;
  /** Label for the confirming button. */
  readonly confirmLabel: ReactNode;
  /** Defaults to destructive — the common case for a confirmation. */
  readonly confirmVariant?: ButtonProps["variant"];
  /** Runs on confirm. Closing is the caller's job, so a failed action keeps the dialog up. */
  readonly onConfirm: () => void;
  /** Puts the confirming button in its loading state and blocks repeat clicks. */
  readonly isPending?: boolean;
  /** Element that opens the dialog. Omit when the caller drives `open` from elsewhere. */
  readonly trigger?: ReactElement | undefined;
}

/**
 * The one shape every confirmation in the app takes: a question, the
 * consequence, and a pair of buttons.
 *
 * `role="alertdialog"` is what makes it a confirmation rather than a modal —
 * clicking outside no longer dismisses it, so an irreversible action always
 * gets an explicit answer. The dismiss button in the header goes for the same
 * reason: Cancel is the only way out other than Escape.
 */
export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "destructive",
  onConfirm,
  isPending = false,
  trigger,
}: ConfirmDialogProps) => (
  <Dialog role="alertdialog" open={open} onOpenChange={onOpenChange}>
    {trigger ? <DialogTrigger render={trigger} /> : null}
    <DialogContent>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <Button variant={confirmVariant} loading={isPending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
