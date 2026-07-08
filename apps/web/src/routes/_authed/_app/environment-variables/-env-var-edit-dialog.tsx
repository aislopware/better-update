import { updateEnvVar } from "@better-update/api-client/react";
import { sealEnvValue } from "@better-update/credentials-crypto";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { performStepUpGatedWrite } from "../../../../lib/env-vault/step-up";
import { getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { StepUpGate, useGuardedEnvValue } from "./-step-up-guard";

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
    mutationFn: async (input: { value: string }) =>
      // Save is step-up-gated server-side; refresh the step-up from this click if the
      // window lapsed (so the passkey prompt fires inside the gesture) before writing.
      performStepUpGatedWrite(async () => {
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
      }),
    onSuccess: async () => {
      toast.success("Value updated");
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
      <FieldGroup>
        <form.Field
          name="value"
          validators={{
            onBlur: ({ value }) =>
              requiredStringSchema.safeParse(value).success ? undefined : "A value is required",
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            const invalid = Boolean(errorMessage);
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="env-var-edit-value">Value</FieldLabel>
                <Textarea
                  id="env-var-edit-value"
                  rows={3}
                  autoComplete="off"
                  className="font-mono text-sm"
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
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting, state.values.value] as const}
        >
          {([canSubmit, isSubmitting, value]) => (
            <Button type="submit" disabled={!canSubmit || value === initialValue || isSubmitting}>
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
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
 * existing value rather than a blank field. A lapsed step-up surfaces an inline
 * passkey prompt (via the shared guard) rather than a dead-end error.
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
  const guarded = useGuardedEnvValue({ envVar, orgId, vault });

  if (guarded.kind === "needs-step-up") {
    return (
      <>
        <StepUpGate
          action="edit"
          verifying={guarded.verifying}
          onVerify={() => {
            guarded.verify();
          }}
        />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        </DialogFooter>
      </>
    );
  }
  if (guarded.kind === "loading") {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner /> Decrypting current value…
      </div>
    );
  }
  if (guarded.kind === "error") {
    return (
      <>
        <p className="text-destructive text-sm">{guarded.message}</p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </>
    );
  }

  return (
    <EditForm
      envVar={envVar}
      orgId={orgId}
      vault={vault}
      initialValue={guarded.value}
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
      <DialogContent className="sm:max-w-lg">
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
      </DialogContent>
    </Dialog>
  );
};
