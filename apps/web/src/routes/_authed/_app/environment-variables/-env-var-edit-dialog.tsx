import { updateEnvVar } from "@better-update/api-client/react";
import { sealEnvValue } from "@better-update/credentials-crypto";
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
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

const EditForm = ({
  envVar,
  orgId,
  vault,
  invalidate,
  onSuccess,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault;
  invalidate: () => Promise<void>;
  onSuccess: () => void;
}) => {
  const updateMutation = useApiMutation({
    mutationFn: async (input: { value: string }) => {
      const sealed = sealEnvValue({
        vaultKey: vault.vaultKey,
        vaultVersion: vault.envVaultVersion,
        vaultKind: "env",
        orgId,
        key: envVar.key,
        environment: envVar.environment,
        value: input.value,
      });
      return updateEnvVar(envVar.id, { value: sealed });
    },
    onSuccess: async () => {
      toastManager.add({ title: "Value updated", type: "success" });
      await invalidate();
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { value: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(updateMutation.mutateAsync({ value: value.value }));
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
          name="value"
          validators={{
            onBlur: ({ value }) =>
              requiredStringSchema.safeParse(value).success ? undefined : "A value is required",
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="env-var-edit-value">New value</FieldLabel>
                <Textarea
                  id="env-var-edit-value"
                  rows={3}
                  autoComplete="off"
                  className="font-mono text-sm"
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
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              Save new value
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/**
 * Edit one env-var value: seal the new plaintext with the unlocked env-vault key
 * (a fresh revision) and PATCH it. The previous value stays in history. The
 * server re-gates the write on a passkey step-up. Controlled by the row's menu.
 */
export const EnvVarEditDialog = ({
  envVar,
  orgId,
  vault,
  invalidate,
  open,
  onOpenChange,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault;
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
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            Edit <span className="font-mono">{envVar.key}</span>
          </DialogTitle>
          <DialogDescription>
            The new value is encrypted in your browser before it is uploaded.
          </DialogDescription>
        </DialogHeader>
        <EditForm
          key={resetKey}
          envVar={envVar}
          orgId={orgId}
          vault={vault}
          invalidate={invalidate}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
