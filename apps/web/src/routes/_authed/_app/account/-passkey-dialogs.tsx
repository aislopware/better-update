import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@better-update/ui/components/ui/alert-dialog";
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
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { FingerprintIcon } from "lucide-react";
import { useState } from "react";

import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { VAULT_HOST, isVaultHost } from "../../../../lib/env-vault/host";
import { getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

import type { UserPasskey } from "../../../../queries/auth";

const NameField = ({
  value,
  error,
  onChange,
  onBlur,
}: {
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
}) => (
  <Field data-invalid={Boolean(error)}>
    <FieldLabel htmlFor="passkey-name">Name</FieldLabel>
    <Input
      id="passkey-name"
      autoComplete="off"
      placeholder="e.g. MacBook Touch ID"
      aria-invalid={Boolean(error) || undefined}
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onBlur={onBlur}
    />
    {error ? <FieldError>{error}</FieldError> : null}
  </Field>
);

const nameValidator = {
  onBlur: ({ value }: { value: string }) =>
    requiredStringSchema.safeParse(value).success ? undefined : "A name is required",
};

const AddPasskeyForm = ({
  invalidate,
  onSuccess,
}: {
  invalidate: () => Promise<void>;
  onSuccess: () => void;
}) => {
  const addMutation = useApiMutation({
    mutationFn: async (input: { name: string }) =>
      rejectOnAuthClientError(
        authClient.passkey.addPasskey({ name: input.name }),
        "Could not add a passkey.",
      ),
    onSuccess: async () => {
      toast.success("Passkey added");
      await invalidate();
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(addMutation.mutateAsync({ name: value.name }));
    },
  });

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <div className="grid gap-4">
        <form.Field name="name" validators={nameValidator}>
          {(field) => (
            <NameField
              value={field.state.value}
              error={getFieldError(field)}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || Boolean(isSubmitting)}>
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <FingerprintIcon strokeWidth={2} data-icon="inline-start" />
              )}
              Add passkey
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/**
 * Enroll a new WebAuthn passkey for the current user (the env-vault step-up
 * factor). Triggers the platform/security-key ceremony on submit, then stores it
 * under the given name. Uncontrolled trigger button; resets on close.
 */
export const AddPasskeyDialog = ({ invalidate }: { invalidate: () => Promise<void> }) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // A passkey ceremony is only valid on the origin that matches the rpID (the
  // vault host). On any other origin, send the user there to enroll — list,
  // rename, and remove still work here since they are plain API calls.
  if (!isVaultHost()) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          globalThis.location.assign(`https://${VAULT_HOST}/account/passkeys`);
        }}
      >
        <FingerprintIcon strokeWidth={2} data-icon="inline-start" />
        Add passkey
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <FingerprintIcon strokeWidth={2} data-icon="inline-start" />
        Add passkey
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a passkey</DialogTitle>
          <DialogDescription>
            A passkey lets you verify with biometrics or a security key — used to unlock the
            environment-variable vault.
          </DialogDescription>
        </DialogHeader>
        <AddPasskeyForm
          key={resetKey}
          invalidate={invalidate}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

const RenamePasskeyForm = ({
  passkey,
  invalidate,
  onSuccess,
}: {
  passkey: UserPasskey;
  invalidate: () => Promise<void>;
  onSuccess: () => void;
}) => {
  const renameMutation = useApiMutation({
    mutationFn: async (input: { name: string }) =>
      rejectOnAuthClientError(
        authClient.passkey.updatePasskey({ id: passkey.id, name: input.name }),
        "Could not rename the passkey.",
      ),
    onSuccess: async () => {
      toast.success("Passkey renamed");
      await invalidate();
      onSuccess();
    },
  });

  const form = useForm({
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- controlled input requires string; an unnamed passkey starts blank
    defaultValues: { name: passkey.name ?? "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(renameMutation.mutateAsync({ name: value.name }));
    },
  });

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <div className="grid gap-4">
        <form.Field name="name" validators={nameValidator}>
          {(field) => (
            <NameField
              value={field.state.value}
              error={getFieldError(field)}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || Boolean(isSubmitting)}>
              {Boolean(isSubmitting) && <Spinner data-icon="inline-start" />}
              Save name
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/** Rename one passkey. Controlled by the row's action. */
export const RenamePasskeyDialog = ({
  passkey,
  invalidate,
  open,
  onOpenChange,
}: {
  passkey: UserPasskey;
  invalidate: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename passkey</DialogTitle>
          <DialogDescription>Give this passkey a recognizable name.</DialogDescription>
        </DialogHeader>
        <RenamePasskeyForm
          key={resetKey}
          passkey={passkey}
          invalidate={invalidate}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

/** Delete one passkey. Controlled by the row's action. */
export const DeletePasskeyDialog = ({
  passkey,
  invalidate,
  open,
  onOpenChange,
}: {
  passkey: UserPasskey;
  invalidate: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const deleteMutation = useApiMutation({
    mutationFn: async () =>
      rejectOnAuthClientError(
        authClient.passkey.deletePasskey({ id: passkey.id }),
        "Could not delete the passkey.",
      ),
    onSuccess: async () => {
      toast.success("Passkey removed");
      await invalidate();
      onOpenChange(false);
    },
  });

  const label = passkey.name ?? "this passkey";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            You will no longer be able to verify with this passkey. If it is your only one, you will
            need to add a new passkey before you can unlock the env-vault again. This cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            {deleteMutation.isPending && <Spinner data-icon="inline-start" />}
            Remove passkey
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
