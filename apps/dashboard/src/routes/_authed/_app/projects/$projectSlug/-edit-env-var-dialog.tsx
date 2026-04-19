import { envVarsQueryKey, updateEnvVar } from "@better-update/api-client/react";
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
import { Field, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { EnvVar } from "@better-update/api";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

const VISIBILITY_LABELS: Record<string, string> = {
  plaintext: "Plaintext",
  sensitive: "Sensitive",
  secret: "Secret",
};

const EditFormContent = ({
  orgId,
  projectId,
  envVar,
  onSuccess,
}: {
  orgId: string;
  projectId: string;
  envVar: typeof EnvVar.Type;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const isEncrypted = envVar.visibility !== "plaintext";
  const updateEnvVarMutation = useApiMutation({
    mutationFn: async (payload: {
      value?: string;
      visibility?: "plaintext" | "sensitive" | "secret";
    }) => updateEnvVar(envVar.id, payload),
    onSuccess: async () => {
      toast.success(`Variable "${envVar.key}" updated`);
      await queryClient.invalidateQueries({
        queryKey: envVarsQueryKey(orgId, projectId),
      });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: {
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- controlled input requires string; encrypted fields render blank by design
      value: isEncrypted ? "" : (envVar.value ?? ""),
      visibility: envVar.visibility,
    },
    onSubmit: async ({ value }) => {
      const payload: { value?: string; visibility?: "plaintext" | "sensitive" | "secret" } = {};
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

      if (Object.keys(payload).length === 0) {
        toast.info("No changes to save");
        onSuccess();
        return;
      }

      await safeSubmit(updateEnvVarMutation.mutateAsync(payload));
    },
  });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <FieldGroup className="py-4">
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
                  if (val === "plaintext" || val === "sensitive" || val === "secret") {
                    field.handleChange(val);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="plaintext">Plaintext</SelectItem>
                    <SelectItem value="sensitive">Sensitive</SelectItem>
                    <SelectItem value="secret">Secret</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? "Saving..." : "Save changes"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const EditEnvVarDialog = ({
  orgId,
  projectId,
  envVar,
  open,
  onOpenChange,
}: {
  orgId: string;
  projectId: string;
  envVar: typeof EnvVar.Type;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Edit variable</DialogTitle>
        <DialogDescription>Update the value or visibility of {envVar.key}.</DialogDescription>
      </DialogHeader>
      {open && (
        <EditFormContent
          orgId={orgId}
          projectId={projectId}
          envVar={envVar}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      )}
    </DialogContent>
  </Dialog>
);
