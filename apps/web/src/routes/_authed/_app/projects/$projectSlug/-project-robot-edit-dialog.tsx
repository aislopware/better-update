import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/dialog";
import { FieldGroup } from "@better-update/ui/components/field-layout";
import { Input } from "@better-update/ui/components/input";
import { Select } from "@better-update/ui/components/select";
import { useState } from "react";

import type { RobotAccountRoleValue } from "@better-update/api-client/react";

import { PROJECT_ROLE_LABELS } from "../../-invite-dialog";
import { onPicked } from "../../../../../lib/form-utils";

import type { EditTarget, RobotAccountChanges } from "./-project-robots-mutations";

const EditForm = ({
  target,
  isPending,
  onSubmit,
}: {
  target: EditTarget;
  isPending: boolean;
  onSubmit: (changes: RobotAccountChanges) => void;
}) => {
  const [name, setName] = useState(target.name);
  const [role, setRole] = useState<RobotAccountRoleValue>(target.role);

  const trimmed = name.trim();
  // The PATCH carries only what actually changed — an unchanged field stays
  // out of the request (and out of the audit entry's intent).
  const changes: RobotAccountChanges = {
    ...(trimmed === target.name ? {} : { name: trimmed }),
    ...(role === target.role ? {} : { role }),
  };
  const hasChanges = Object.keys(changes).length > 0;

  return (
    <>
      <FieldGroup>
        <Input
          label="Name"
          id="robot-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Select
          label="Role"
          className="w-full"
          items={PROJECT_ROLE_LABELS}
          value={role}
          onValueChange={onPicked(setRole)}
        />
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <Button
          variant="primary"
          disabled={trimmed.length === 0 || !hasChanges || isPending}
          onClick={() => {
            onSubmit(changes);
          }}
          loading={isPending}
        >
          Save changes
        </Button>
      </DialogFooter>
    </>
  );
};

// Opened from the robots table's row menu — the caller owns the open state and
// the target (feedback: lift dialog state out of the menu). The form is keyed
// by the target so each open starts from that robot's current name + role; the
// target is cleared only in onOpenChangeComplete so the content never vanishes
// mid-close-animation.
export const EditRobotDialog = ({
  target,
  open,
  isPending,
  onOpenChange,
  onClosed,
  onSubmit,
}: {
  target: EditTarget | null;
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
  onSubmit: (changes: RobotAccountChanges) => void;
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
    <DialogContent size="lg">
      <DialogHeader>
        <DialogTitle>Edit robot account</DialogTitle>
        <DialogDescription>
          Rename the robot and/or change its project role. A rename also renames the vault identity
          registered with it; the bearer secret, project, and vault access are untouched.
        </DialogDescription>
      </DialogHeader>
      {target === null ? null : (
        <EditForm key={target.id} target={target} isPending={isPending} onSubmit={onSubmit} />
      )}
    </DialogContent>
  </Dialog>
);
