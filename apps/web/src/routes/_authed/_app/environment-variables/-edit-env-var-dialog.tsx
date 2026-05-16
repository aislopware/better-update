import {
  envVarsQueryKey,
  globalEnvVarsQueryKey,
  updateEnvVar,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";

import type { EnvVar, EnvVarEnvironment } from "@better-update/api";

import { getFieldError } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { EnvironmentsPicker } from "./-environments-picker";

const VISIBILITY_LABELS: Record<string, string> = {
  plaintext: "Plaintext",
  sensitive: "Sensitive",
};

const arraysEqual = (
  left: readonly (typeof EnvVarEnvironment.Type)[],
  right: readonly (typeof EnvVarEnvironment.Type)[],
) => {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].toSorted();
  const sortedRight = [...right].toSorted();
  return sortedLeft.every((env, index) => env === sortedRight[index]);
};

const EditFormContent = ({
  orgId,
  envVar,
  onSuccess,
}: {
  orgId: string;
  envVar: typeof EnvVar.Type;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const isEncrypted = envVar.visibility !== "plaintext";
  const updateEnvVarMutation = useApiMutation({
    mutationFn: async (payload: {
      value?: string;
      visibility?: "plaintext" | "sensitive";
      environments?: readonly (typeof EnvVarEnvironment.Type)[];
    }) => updateEnvVar(envVar.id, payload),
    onSuccess: async () => {
      toastManager.add({ title: `Variable "${envVar.key}" updated`, type: "success" });
      if (envVar.projectId) {
        await queryClient.invalidateQueries({
          queryKey: envVarsQueryKey(orgId, envVar.projectId),
        });
      }
      await queryClient.invalidateQueries({ queryKey: globalEnvVarsQueryKey(orgId) });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: {
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- controlled input requires string; encrypted fields render blank by design
      value: isEncrypted ? "" : (envVar.value ?? ""),
      visibility: envVar.visibility,
      environments: envVar.environments,
    },
    onSubmit: async ({ value }) => {
      const payload: {
        value?: string;
        visibility?: "plaintext" | "sensitive";
        environments?: readonly (typeof EnvVarEnvironment.Type)[];
      } = {};
      if (isEncrypted) {
        if (value.value.length > 0) {
          payload.value = value.value;
        }
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- compare against normalized default used in form
      } else if (value.value !== (envVar.value ?? "")) {
        payload.value = value.value;
      }
      if (value.visibility !== envVar.visibility) {
        payload.visibility = value.visibility;
      }
      if (!arraysEqual(value.environments, envVar.environments)) {
        payload.environments = value.environments;
      }

      if (Object.keys(payload).length === 0) {
        toastManager.add({ title: "No changes to save", type: "info" });
        onSuccess();
        return;
      }

      await safeSubmit(updateEnvVarMutation.mutateAsync(payload));
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
      <DialogPanel>
        <FieldGroup>
          <Field>
            <FieldLabel>Key</FieldLabel>
            <Input value={envVar.key} disabled className="font-mono" />
          </Field>

          <form.Field name="value">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="env-var-value">Value</FieldLabel>
                <Textarea
                  id="env-var-value"
                  placeholder={isEncrypted ? "Enter new value to replace existing" : ""}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  rows={3}
                  className="font-mono"
                />
                {isEncrypted ? (
                  <p className="text-muted-foreground text-xs">
                    Current value is encrypted. Enter a new value to replace it, or leave empty to
                    keep unchanged.
                  </p>
                ) : null}
              </Field>
            )}
          </form.Field>

          <form.Field name="visibility">
            {(field) => (
              <Field>
                <FieldLabel>Visibility</FieldLabel>
                <Select
                  items={VISIBILITY_LABELS}
                  value={field.state.value}
                  onValueChange={(val) => {
                    if (val === "plaintext" || val === "sensitive") {
                      field.handleChange(val);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectGroup>
                      <SelectItem value="plaintext">Plaintext</SelectItem>
                      <SelectItem value="sensitive">Sensitive</SelectItem>
                    </SelectGroup>
                  </SelectPopup>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field
            name="environments"
            validators={{
              onChange: ({ value }) =>
                value.length === 0 ? "Select at least one environment" : undefined,
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <Field data-invalid={errorMessage ? true : undefined}>
                  <FieldLabel>Environments</FieldLabel>
                  <EnvironmentsPicker
                    value={field.state.value}
                    onChange={(value) => {
                      field.handleChange(value);
                    }}
                  />
                  <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              Save changes
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const EditEnvVarDialog = ({
  orgId,
  envVar,
  open,
  onOpenChange,
}: {
  orgId: string;
  envVar: typeof EnvVar.Type;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Edit variable</DialogTitle>
        <DialogDescription>
          {envVar.scope === "global"
            ? `Update the organization-wide variable ${envVar.key}.`
            : `Update the value, visibility, or environments of ${envVar.key}.`}
        </DialogDescription>
      </DialogHeader>
      {open && (
        <EditFormContent
          orgId={orgId}
          envVar={envVar}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      )}
    </DialogPopup>
  </Dialog>
);
