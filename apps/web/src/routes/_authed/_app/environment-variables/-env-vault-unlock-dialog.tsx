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
import { useForm } from "@tanstack/react-form";
import { FingerprintIcon, LockKeyholeOpenIcon } from "lucide-react";
import { useState } from "react";

import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { runPasskeyStepUp } from "../../../../lib/env-vault/step-up";
import { unlockEnvVault } from "../../../../lib/env-vault/unlock";
import { getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

const PASSKEY_NAME = "Env vault passkey";

const UnlockForm = ({
  orgId,
  onUnlocked,
  onSuccess,
}: {
  orgId: string;
  onUnlocked: (vault: UnlockedEnvVault) => void;
  onSuccess: () => void;
}) => {
  const enrollMutation = useApiMutation({
    mutationFn: async () =>
      rejectOnAuthClientError(
        authClient.passkey.addPasskey({ name: PASSKEY_NAME }),
        "Could not add a passkey.",
      ),
    onSuccess: () => {
      toastManager.add({ title: "Passkey added. Now verify to unlock.", type: "success" });
    },
  });

  const unlockMutation = useApiMutation({
    mutationFn: async (input: { passphrase: string }) => {
      await runPasskeyStepUp();
      return unlockEnvVault(orgId, input.passphrase);
    },
    onSuccess: (vault) => {
      toastManager.add({ title: "Env vault unlocked", type: "success" });
      onUnlocked(vault);
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { passphrase: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(unlockMutation.mutateAsync({ passphrase: value.passphrase }));
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
      <DialogPanel className="grid gap-4">
        <form.Field
          name="passphrase"
          validators={{
            onBlur: ({ value }) =>
              requiredStringSchema.safeParse(value).success ? undefined : "Passphrase is required",
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="env-vault-passphrase">Account passphrase</FieldLabel>
                <Input
                  id="env-vault-passphrase"
                  type="password"
                  autoComplete="off"
                  placeholder="Your env-vault account passphrase"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
        <p className="text-muted-foreground text-sm">
          No passkey on this device yet?{" "}
          <Button
            variant="link"
            size="sm"
            type="button"
            loading={enrollMutation.isPending}
            onClick={() => {
              enrollMutation.mutate();
            }}
          >
            Add a passkey
          </Button>
        </p>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              <FingerprintIcon strokeWidth={2} data-icon="inline-start" />
              Verify &amp; unlock
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/**
 * Unlock the org's env vault for this browser session: a WebAuthn step-up
 * (re-proving the cookie session) followed by the account passphrase, which
 * decrypts the account key and unwraps the env-vault key locally. On success the
 * unwrapped key is cached in sessionStorage and handed to the caller via
 * `onUnlocked`. Only rendered on the dedicated vault origin (host-gated upstream).
 */
export const EnvVaultUnlockDialog = ({
  orgId,
  onUnlocked,
}: {
  orgId: string;
  onUnlocked: (vault: UnlockedEnvVault) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

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
        <LockKeyholeOpenIcon strokeWidth={2} data-icon="inline-start" />
        Unlock env vault
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Unlock the env vault</DialogTitle>
          <DialogDescription>
            Verify with a passkey, then enter your account passphrase to decrypt and edit
            environment variable values in this browser session.
          </DialogDescription>
        </DialogHeader>
        <UnlockForm
          key={resetKey}
          orgId={orgId}
          onUnlocked={onUnlocked}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
