import { accountKeysQueryKey, registerAccountKey } from "@better-update/api-client/react";
import { generateAccountKey, sealAccountKey } from "@better-update/credentials-crypto";
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
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { useState } from "react";

import { getFieldError, passwordSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

/** A passphrase input wrapped in a coss Field — extracted to keep the form tree shallow. */
const PassphraseField = ({
  id,
  label,
  value,
  error,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  onBlur: () => void;
}) => (
  <Field invalid={Boolean(error)}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input
      id={id}
      type="password"
      autoComplete="new-password"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onBlur={onBlur}
    />
    <FieldError match={Boolean(error)}>{error}</FieldError>
  </Field>
);

const EnrollAccountKeyForm = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();

  const enrollMutation = useApiMutation({
    // Generate the keypair and seal it under the user's OWN passphrase entirely in
    // the browser (Argon2id ≈ 128 MiB — runs on the main thread for a few seconds),
    // then register the opaque escrow. The server never sees the passphrase or the
    // private key. Mirrors the CLI `credentials account create` field mapping.
    mutationFn: async (input: { passphrase: string }) => {
      const material = await generateAccountKey();
      const envelope = sealAccountKey({ material, passphrase: input.passphrase });
      return registerAccountKey({
        agePublicKey: envelope.agePublicKey,
        ed25519PublicKey: envelope.ed25519PublicKey,
        fingerprint: envelope.fingerprint,
        kdfParams: envelope.kdfParams,
        salt: envelope.salt,
        escrowCt: envelope.ct,
      });
    },
    onSuccess: async () => {
      toastManager.add({
        title: "Account key enrolled",
        description: "An admin must grant it env-vault access before you can unlock here.",
        type: "success",
      });
      await queryClient.invalidateQueries({ queryKey: accountKeysQueryKey(orgId) });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { passphrase: "", confirmPassphrase: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(enrollMutation.mutateAsync({ passphrase: value.passphrase }));
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
        <p className="text-muted-foreground text-sm">
          Choose a passphrase that unlocks your env-vault access. It never leaves this browser and
          cannot be recovered — if you forget it you must re-enroll.
        </p>
        <form.Field
          name="passphrase"
          validators={{
            onBlur: ({ value }) =>
              passwordSchema.safeParse(value).success
                ? undefined
                : "Passphrase must be at least 8 characters",
          }}
        >
          {(field) => (
            <PassphraseField
              id="account-key-passphrase"
              label="Passphrase"
              value={field.state.value}
              error={getFieldError(field)}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
        <form.Field
          name="confirmPassphrase"
          validators={{
            onChangeListenTo: ["passphrase"],
            onChange: ({ value, fieldApi }) =>
              value === fieldApi.form.getFieldValue("passphrase")
                ? undefined
                : "Passphrases do not match",
          }}
        >
          {(field) => (
            <PassphraseField
              id="account-key-passphrase-confirm"
              label="Confirm passphrase"
              value={field.state.value}
              error={getFieldError(field)}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
            />
          )}
        </form.Field>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Spinner /> Generating &amp; sealing…
                </>
              ) : (
                <>
                  <KeyRoundIcon strokeWidth={2} data-icon="inline-start" />
                  Enroll account key
                </>
              )}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/**
 * Enroll the caller's per-user account key from the browser (the env-vault
 * recipient the browser unwraps env values with). The user picks their own
 * passphrase; the keypair is generated and sealed locally, then the opaque escrow
 * is registered. Account-key creation is bearer-self (no passkey/step-up needed),
 * but using it to unlock still requires a passkey + an admin grant — so after
 * enrollment the user waits for an admin to grant env access. Only rendered on the
 * vault origin (host-gated upstream).
 */
export const EnrollAccountKeyDialog = ({ orgId }: { orgId: string }) => {
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
        <KeyRoundIcon strokeWidth={2} data-icon="inline-start" />
        Set up vault access
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Set up env-vault access</DialogTitle>
          <DialogDescription>
            Enroll an account key so you can unlock and edit environment variable values from this
            browser.
          </DialogDescription>
        </DialogHeader>
        <EnrollAccountKeyForm
          key={resetKey}
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
