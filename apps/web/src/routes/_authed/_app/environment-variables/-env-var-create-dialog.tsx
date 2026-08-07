import { createEnvVar } from "@better-update/api-client/react";
import { sealEnvValue } from "@better-update/credentials-crypto";
import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { Field } from "@better-update/ui/components/field";
import {
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldSetDescription,
} from "@better-update/ui/components/field-layout";
import { Input, Textarea } from "@better-update/ui/components/input";
import { toast } from "@better-update/ui/components/toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
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
  <Field label={label}>
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger id={id} className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Object.entries(items).map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  </Field>
);

const submitSelector = (state: { canSubmit: boolean; isSubmitting: boolean }) =>
  [state.canSubmit, state.isSubmitting] as const;

const renderSubmitButton = ([canSubmit, isSubmitting]: readonly [boolean, boolean]) => (
  <Button
    variant="primary"
    type="submit"
    disabled={!canSubmit || isSubmitting}
    loading={isSubmitting}
  >
    Create variable
  </Button>
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
    mutationFn: async (input: { key: string; value: string; label: string; description: string }) =>
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
        // Optional non-secret documentation, omitted when blank (the label lives
        // per scope+key, shared across environments — see the details dialog).
        const label = input.label.trim();
        const description = input.description.trim();
        const docs = {
          ...(label ? { label } : {}),
          ...(description ? { description } : {}),
        };
        const body =
          scope === "project" && projectId
            ? {
                scope: "project" as const,
                projectId,
                environment,
                key: input.key,
                visibility,
                value: sealed,
                ...docs,
              }
            : {
                scope: "global" as const,
                environment,
                key: input.key,
                visibility,
                value: sealed,
                ...docs,
              };
        return createEnvVar(body);
      }),
    onSuccess: async () => {
      toast.success("Variable created");
      await invalidate();
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { key: "", value: "", label: "", description: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(
        createMutation.mutateAsync({
          key: value.key,
          value: value.value,
          label: value.label,
          description: value.description,
        }),
      );
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
        <FieldSet>
          <FieldLegend>Variable</FieldLegend>
          <FieldSetDescription>
            Pick the environment this variable applies to and name its key.
          </FieldSetDescription>
          <FieldGroup>
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
                  <Input
                    label="Key"
                    error={errorMessage}
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
                );
              }}
            </form.Field>
          </FieldGroup>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Value</FieldLegend>
          <FieldSetDescription>
            The value is encrypted before upload; visibility controls how it shows up in logs.
          </FieldSetDescription>
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
                return (
                  <Textarea
                    label="Value"
                    error={errorMessage}
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
          </FieldGroup>
        </FieldSet>
        <FieldSeparator />
        <FieldSet>
          <FieldLegend>Documentation</FieldLegend>
          <FieldSetDescription>
            Optional non-secret notes, shared across environments for this key.
          </FieldSetDescription>
          <FieldGroup>
            <form.Field name="label">
              {(field) => (
                <Input
                  label="Label (optional)"
                  id="env-var-create-label"
                  autoComplete="off"
                  maxLength={120}
                  placeholder="Payment API base URL"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <Textarea
                  label="Description (optional)"
                  id="env-var-create-description"
                  rows={2}
                  autoComplete="off"
                  maxLength={500}
                  placeholder="What this value is for, so anyone can update it confidently."
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <form.Subscribe selector={submitSelector}>{renderSubmitButton}</form.Subscribe>
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
      <DialogTrigger render={<Button variant="primary" />}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add variable
      </DialogTrigger>
      <DialogContent size="lg">
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
      </DialogContent>
    </Dialog>
  );
};
