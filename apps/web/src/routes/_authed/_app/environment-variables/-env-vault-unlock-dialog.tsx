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
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FingerprintIcon, LockKeyholeOpenIcon } from "lucide-react";
import { useState } from "react";

import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { runPasskeyStepUp } from "../../../../lib/env-vault/step-up";
import { unlockEnvVault } from "../../../../lib/env-vault/unlock";
import { getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { passkeysQueryOptions } from "../../../../queries/auth";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

const PASSKEY_NAME = "Env vault passkey";

/**
 * Below-the-passphrase hint. Until the passkey list resolves we show nothing (so
 * we never wrongly nag "no passkey" after one was just added); once it's known we
 * either offer inline enrollment (none yet) or link to the management page.
 */
const PasskeyPrompt = ({
  hasPasskey,
  enrolling,
  onAdd,
}: {
  hasPasskey: boolean | undefined;
  enrolling: boolean;
  onAdd: () => void;
}) => {
  if (hasPasskey === undefined) {
    return null;
  }
  if (hasPasskey) {
    return (
      <p className="text-muted-foreground text-sm">
        Manage your passkeys in{" "}
        <Button variant="link" size="sm" render={<Link to="/account/passkeys" />}>
          account settings
        </Button>
        .
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-sm">
      No passkey yet?{" "}
      <Button variant="link" size="sm" type="button" disabled={enrolling} onClick={onAdd}>
        {enrolling ? <Spinner data-icon="inline-start" /> : null}
        Add a passkey
      </Button>
    </p>
  );
};

const UnlockForm = ({
  orgId,
  onUnlocked,
  onSuccess,
}: {
  orgId: string;
  onUnlocked: (vault: UnlockedEnvVault) => void;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const passkeysQuery = useQuery(passkeysQueryOptions);

  const enrollMutation = useApiMutation({
    mutationFn: async () =>
      rejectOnAuthClientError(
        authClient.passkey.addPasskey({ name: PASSKEY_NAME }),
        "Could not add a passkey.",
      ),
    onSuccess: async () => {
      toast.success("Passkey added. Now verify to unlock.");
      await queryClient.invalidateQueries({ queryKey: passkeysQueryOptions.queryKey });
    },
  });

  const unlockMutation = useApiMutation({
    mutationFn: async (input: { passphrase: string }) => {
      await runPasskeyStepUp();
      return unlockEnvVault(orgId, input.passphrase);
    },
    onSuccess: (vault) => {
      toast.success("Env vault unlocked");
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
      <FieldGroup>
        <form.Field
          name="passphrase"
          validators={{
            onBlur: ({ value }) =>
              requiredStringSchema.safeParse(value).success ? undefined : "Passphrase is required",
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            const invalid = Boolean(errorMessage);
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="env-vault-passphrase">Account passphrase</FieldLabel>
                <Input
                  id="env-vault-passphrase"
                  type="password"
                  autoComplete="off"
                  placeholder="Your env-vault account passphrase"
                  aria-invalid={invalid || undefined}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                {invalid ? <FieldError>{errorMessage}</FieldError> : null}
              </Field>
            );
          }}
        </form.Field>
        <PasskeyPrompt
          hasPasskey={passkeysQuery.data === undefined ? undefined : passkeysQuery.data.length > 0}
          enrolling={enrollMutation.isPending}
          onAdd={() => {
            enrollMutation.mutate();
          }}
        />
      </FieldGroup>
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
      <DialogContent>
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
      </DialogContent>
    </Dialog>
  );
};
