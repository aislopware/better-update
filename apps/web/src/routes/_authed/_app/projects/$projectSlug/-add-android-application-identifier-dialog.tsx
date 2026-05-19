import { createAndroidApplicationIdentifier } from "@better-update/api-client/react";
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
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

const PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/u;

interface FormState {
  readonly packageName: string;
}

const INITIAL: FormState = { packageName: "" };

interface AddAndroidApplicationIdentifierDialogProps {
  readonly orgId: string;
  readonly projectId: string;
  readonly onCreated: () => Promise<void>;
}

export const AddAndroidApplicationIdentifierDialog = ({
  projectId,
  onCreated,
}: AddAndroidApplicationIdentifierDialogProps) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FormState>(INITIAL);
  const valid = PACKAGE_PATTERN.test(state.packageName);

  const createMutation = useApiMutation({
    mutationFn: async () =>
      createAndroidApplicationIdentifier(projectId, { packageName: state.packageName }),
    onSuccess: async () => {
      toastManager.add({ title: "Application identifier added", type: "success" });
      await onCreated();
      setOpen(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setState(INITIAL);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <PlusIcon data-icon="inline-start" />
            Add Application Identifier
          </Button>
        }
      />
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add Application Identifier</DialogTitle>
          <DialogDescription>
            Register an Android package name for this project. Add keystores and service account
            keys after the identifier is created.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Field>
            <FieldLabel htmlFor="package-name">Package name</FieldLabel>
            <Input
              id="package-name"
              value={state.packageName}
              placeholder="com.example.app"
              onChange={(event) => {
                setState({ packageName: event.target.value });
              }}
            />
            <FieldError match={state.packageName.length > 0 && !valid}>
              Package name must be reverse-domain style (e.g., com.acme.app)
            </FieldError>
          </Field>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={!valid}
            loading={createMutation.isPending}
            onClick={async () => {
              await safeSubmit(createMutation.mutateAsync(undefined));
            }}
          >
            Add identifier
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
