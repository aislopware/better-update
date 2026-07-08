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
import { Field, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { useState } from "react";

import type { RenameTarget } from "./-project-robots-mutations";

const RenameForm = ({
  target,
  isPending,
  onSubmit,
}: {
  target: RenameTarget;
  isPending: boolean;
  onSubmit: (name: string) => void;
}) => {
  const [name, setName] = useState(target.name);
  const trimmed = name.trim();

  return (
    <>
      <DialogPanel>
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          disabled={trimmed.length === 0 || trimmed === target.name}
          loading={isPending}
          onClick={() => {
            onSubmit(trimmed);
          }}
        >
          Rename
        </Button>
      </DialogFooter>
    </>
  );
};

// Opened from the robots table's row menu — the caller owns the open state and
// the target (feedback: lift dialog state out of the menu). The form is keyed
// by the target so each open starts from that robot's current name; the target
// is cleared only in onOpenChangeComplete so the content never vanishes
// mid-close-animation.
export const RenameRobotDialog = ({
  target,
  open,
  isPending,
  onOpenChange,
  onClosed,
  onSubmit,
}: {
  target: RenameTarget | null;
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  onSubmit: (name: string) => void;
}) => (
  <Dialog
    open={open}
    onOpenChange={onOpenChange}
    onOpenChangeComplete={(next) => {
      if (!next) {
        onClosed();
      }
    }}
  >
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Rename robot account</DialogTitle>
        <DialogDescription>
          Renames the robot and the vault identity registered with it. Its bearer secret and access
          are untouched.
        </DialogDescription>
      </DialogHeader>
      {target === null ? null : (
        <RenameForm key={target.id} target={target} isPending={isPending} onSubmit={onSubmit} />
      )}
    </DialogPopup>
  </Dialog>
);
