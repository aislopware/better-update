import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { useState } from "react";

import type { ReactNode } from "react";

import { safeSubmit } from "../../../../../lib/use-api-mutation";

interface SavedSlotProps {
  readonly selectedId: string;
  readonly setSelectedId: (id: string) => void;
}

interface SubmitContext {
  readonly selectedId: string;
}

interface ChangeCredentialDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly title: string;
  readonly description: string;
  /** Pre-selected saved id (current credential); also the value restored on close. */
  readonly initialSelectedId: string;
  readonly submitting: boolean;
  /** Triggers the per-credential save mutation. Shell wraps the call in `safeSubmit`. */
  readonly onSubmit: (context: SubmitContext) => Promise<void>;
  readonly renderSaved: (props: SavedSlotProps) => ReactNode;
}

/**
 * Shared scaffold for the "change credential" dialogs (keystore, GSA, cert,
 * profile, ASC key, push key). Owns the `Dialog` + reset-on-close wiring, the
 * `selectedId` state, the `canSubmit` rule, and the footer (ghost Cancel +
 * loading Save). Each credential supplies its saved slot and the submit mutation.
 */
export const ChangeCredentialDialog = ({
  open,
  onOpenChange,
  title,
  description,
  initialSelectedId,
  submitting,
  onSubmit,
  renderSaved,
}: ChangeCredentialDialogProps) => {
  const [selectedId, setSelectedId] = useState<string>(initialSelectedId);

  const canSubmit = selectedId.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setSelectedId(initialSelectedId);
        }
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>{renderSaved({ selectedId, setSelectedId })}</DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!canSubmit}
            loading={submitting}
            onClick={async () => {
              await safeSubmit(onSubmit({ selectedId }));
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
