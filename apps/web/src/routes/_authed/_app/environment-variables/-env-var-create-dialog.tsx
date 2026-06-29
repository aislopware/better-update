import { createEnvVar } from "@better-update/api-client/react";
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
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { performStepUpGatedWrite } from "../../../../lib/env-vault/step-up";
import { envVarKeySchema, getFieldError, requiredStringSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { formatEnvironmentLabel } from "./-env-vars-labels";
import { useEnvironmentNames } from "./-environments-picker";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

type Visibility = "plaintext" | "sensitive";

const VISIBILITY_LABELS: Record<Visibility, string> = {
  sensitive: "Sensitive (hidden in logs)",
  plaintext: "Plaintext",
};

const SelectField = ({
  id,
  label,
  value,
  items,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  items: Record<string, string>;
  onChange: (next: string) => void;
}) => (
  <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          {Object.entries(items).map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  </Field>
);

const CreateForm = ({
  orgId,
  scope,
  projectId,
  vault,
  invalidate,
  envNames,
  onSuccess,
}: {
  orgId: string;
  scope: "project" | "global";
  projectId: string | undefined;
  vault: UnlockedEnvVault;
  invalidate: () => Promise<void>;
  envNames: readonly string[];
  onSuccess: () => void;
}) => {
  const environmentItems = useMemo<Record<string, string>>(
    () => Object.fromEntries(envNames.map((name) => [name, formatEnvironmentLabel(name)])),
    [envNames],
  );
  const [environment, setEnvironment] = useState<string>(envNames[0] ?? "production");
  const [visibility, setVisibility] = useState<Visibility>("sensitive");

  const createMutation = useApiMutation({
    mutationFn: async (input: { key: string; value: string }) =>
      // Create is step-up-gated server-side; refresh the step-up from this click if the
      // window lapsed (so the passkey prompt fires inside the gesture) before writing.
      performStepUpGatedWrite(async () => {
        const sealed = sealEnvValue({
          vaultKey: vault.vaultKey,
          vaultVersion: vault.envVaultVersion,
          vaultKind: "env",
          orgId,
          key: input.key,
          environment,
          value: input.value,
        });
        const body =
          scope === "project" && projectId
            ? {
                scope: "project" as const,
                projectId,
                environment,
                key: input.key,
                visibility,
                value: sealed,
              }
            : { scope: "global" as const, environment, key: input.key, visibility, value: sealed };
        return createEnvVar(body);
      }),
    onSuccess: async () => {
      toastManager.add({ title: "Variable created", type: "success" });
      await invalidate();
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { key: "", value: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(createMutation.mutateAsync({ key: value.key, value: value.value }));
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
        <SelectField
          id="env-var-create-environment"
          label="Environment"
          value={environment}
          items={environmentItems}
          onChange={setEnvironment}
        />
        <form.Field
          name="key"
          validators={{
            onBlur: ({ value }) => {
              const result = envVarKeySchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="env-var-create-key">Key</FieldLabel>
                <Input
                  id="env-var-create-key"
                  autoComplete="off"
                  placeholder="API_TOKEN"
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
                <FieldLabel htmlFor="env-var-create-value">Value</FieldLabel>
                <Textarea
                  id="env-var-create-value"
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
        <SelectField
          id="env-var-create-visibility"
          label="Visibility"
          value={visibility}
          items={VISIBILITY_LABELS}
          onChange={(next) => {
            setVisibility(next === "plaintext" ? "plaintext" : "sensitive");
          }}
        />
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              Create variable
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/**
 * Create a new env var with its first value, sealed in the browser with the
 * unlocked env-vault key. Scope follows the current view (project vs global).
 * Only rendered on the dedicated vault origin once the vault is unlocked.
 */
export const EnvVarCreateDialog = ({
  orgId,
  scope,
  projectId,
  vault,
  invalidate,
}: {
  orgId: string;
  scope: "project" | "global";
  projectId: string | undefined;
  vault: UnlockedEnvVault;
  invalidate: () => Promise<void>;
}) => {
  const envNames = useEnvironmentNames(orgId);
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
      <DialogTrigger render={<Button />}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add variable
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Add an environment variable</DialogTitle>
          <DialogDescription>
            The value is encrypted in your browser before it is uploaded.
          </DialogDescription>
        </DialogHeader>
        <CreateForm
          key={resetKey}
          orgId={orgId}
          scope={scope}
          projectId={projectId}
          vault={vault}
          invalidate={invalidate}
          envNames={envNames}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
