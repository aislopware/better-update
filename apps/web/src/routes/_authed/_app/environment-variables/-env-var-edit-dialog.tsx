import { getApiError } from "@better-update/api-client";
import { getEnvVarValue, updateEnvVar } from "@better-update/api-client/react";
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
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { EnvVar } from "@better-update/api";

import { revealEnvValue } from "../../../../lib/env-vault/reveal";
import { getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

const EditForm = ({
  envVar,
  orgId,
  vault,
  initialValue,
  invalidate,
  onSuccess,
}: {
  envVar: EnvVar;
  orgId: string;
  vault: UnlockedEnvVault;
  initialValue: string;
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
    defaultValues: { value: initialValue },
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
                <FieldLabel htmlFor="env-var-edit-value">Value</FieldLabel>
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
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting, state.values.value] as const}
        >
          {([canSubmit, isSubmitting, value]) => (
            <Button
              type="submit"
              disabled={!canSubmit || value === initialValue}
              loading={isSubmitting}
            >
              Save new value
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/**
 * Load the current value for editing: fetch the sealed envelope (the server gates
 * this on a fresh passkey step-up, same as reveal), decrypt it locally with the
 * unlocked vault key, and seed the edit form with it so changes start from the
 * existing value rather than a blank field.
 */
const EditBody = ({
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
  // Don't retain the sealed envelope in the query cache beyond the open dialog.
  const valueQuery = useQuery({
    queryKey: ["env-var-value", envVar.id],
    queryFn: async () => getEnvVarValue(envVar.id),
    staleTime: 0,
    gcTime: 0,
  });

  const revealed = useMemo(
    () =>
      valueQuery.data
        ? revealEnvValue({
            vault,
            orgId,
            envelope: valueQuery.data,
            expectKey: envVar.key,
            expectEnvironment: envVar.environment,
          })
        : null,
    [valueQuery.data, vault, orgId, envVar.key, envVar.environment],
  );

  if (valueQuery.isPending) {
    return (
      <DialogPanel>
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Decrypting current value…
        </div>
      </DialogPanel>
    );
  }
  if (valueQuery.isError || revealed === null || !revealed.ok) {
    const message = valueQuery.isError
      ? getApiError(valueQuery.error)
      : (revealed?.ok === false && revealed.error) ||
        "Could not load this value. Please try again.";
    return (
      <>
        <DialogPanel>
          <p className="text-destructive text-sm">{message}</p>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
        </DialogFooter>
      </>
    );
  }

  return (
    <EditForm
      envVar={envVar}
      orgId={orgId}
      vault={vault}
      initialValue={revealed.value}
      invalidate={invalidate}
      onSuccess={onSuccess}
    />
  );
};

/**
 * Edit one env-var value: decrypt the current value to seed the form, then seal
 * the new plaintext with the unlocked env-vault key (a fresh revision) and PATCH
 * it. The previous value stays in history. The server re-gates both the read and
 * the write on a passkey step-up. Controlled by the row's menu.
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
        {open ? (
          <EditBody
            key={resetKey}
            envVar={envVar}
            orgId={orgId}
            vault={vault}
            invalidate={invalidate}
            onSuccess={() => {
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
};
