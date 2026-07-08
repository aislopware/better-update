import { updateEnvVarDescription } from "@better-update/api-client/react";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { toInputValue } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

// An empty field clears the stored value (sent as null); a non-empty one sets it.
const toNullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const DetailsForm = ({
  envVar,
  invalidate,
  onSuccess,
}: {
  envVar: EnvVar;
  invalidate: () => Promise<void>;
  onSuccess: () => void;
}) => {
  // Documentation is non-secret and shared per (scope, key), so this write needs
  // no vault and no passkey step-up — a plain authenticated PATCH.
  const updateMutation = useApiMutation({
    mutationFn: async (input: { label: string; description: string }) =>
      updateEnvVarDescription({
        scope: envVar.scope,
        ...(envVar.scope === "project" && envVar.projectId ? { projectId: envVar.projectId } : {}),
        key: envVar.key,
        label: toNullable(input.label),
        description: toNullable(input.description),
      }),
    onSuccess: async () => {
      toast.success("Details saved");
      await invalidate();
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: {
      label: toInputValue(envVar.label),
      description: toInputValue(envVar.description),
    },
    onSubmit: async ({ value }) => {
      await safeSubmit(
        updateMutation.mutateAsync({ label: value.label, description: value.description }),
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
        <form.Field name="label">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="env-var-details-label">Label</FieldLabel>
              <Input
                id="env-var-details-label"
                autoComplete="off"
                maxLength={120}
                placeholder="Payment API base URL"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
              <FieldDescription>A short, human-readable name for this variable.</FieldDescription>
            </Field>
          )}
        </form.Field>
        <form.Field name="description">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="env-var-details-description">Description</FieldLabel>
              <Textarea
                id="env-var-details-description"
                rows={3}
                autoComplete="off"
                maxLength={500}
                placeholder="What this value is for and where it comes from, so anyone can update it confidently."
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
              <FieldDescription>
                Shown next to the variable in every environment. Not a secret.
              </FieldDescription>
            </Field>
          )}
        </form.Field>
      </FieldGroup>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
              Save details
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

/**
 * Edit a variable's non-secret documentation (label + description). Shared across
 * every environment for the same (scope, key), so it explains what the variable is
 * regardless of the value. Unlike the value/reveal dialogs this needs no unlocked
 * vault and no passkey step-up, so it stays available even while the vault is
 * locked — the whole point is that non-technical people can annotate variables.
 */
export const EnvVarDetailsDialog = ({
  envVar,
  invalidate,
  open,
  onOpenChange,
}: {
  envVar: EnvVar;
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
            Edit details for <span className="font-mono">{envVar.key}</span>
          </DialogTitle>
          <DialogDescription>
            A label and description help everyone understand what this variable is for. These are
            not secrets and apply to every environment.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <DetailsForm
            key={resetKey}
            envVar={envVar}
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
