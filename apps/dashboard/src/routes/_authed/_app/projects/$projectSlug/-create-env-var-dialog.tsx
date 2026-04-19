import { createEnvVar, envVarsQueryKey } from "@better-update/api-client/react";
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
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  envVarKeySchema,
  getFieldError,
  requiredStringSchema,
} from "../../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";

const VISIBILITY_LABELS: Record<string, string> = {
  plaintext: "Plaintext — visible everywhere",
  sensitive: "Sensitive — masked in dashboard",
  secret: "Secret — hidden in dashboard, CLI only",
};

const CreateFormContent = ({
  orgId,
  projectId,
  environment,
  onSuccess,
}: {
  orgId: string;
  projectId: string;
  environment: string;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const createEnvVarMutation = useApiMutation({
    mutationFn: async (value: {
      key: string;
      value: string;
      visibility: "plaintext" | "sensitive" | "secret";
    }) =>
      createEnvVar({
        projectId,
        environment,
        key: value.key,
        value: value.value,
        visibility: value.visibility,
      }),
    onSuccess: async (_, value) => {
      toast.success(`Variable "${value.key}" created`);
      await queryClient.invalidateQueries({
        queryKey: envVarsQueryKey(orgId, projectId),
      });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: {
      key: "",
      value: "",
      visibility: "plaintext" as "plaintext" | "sensitive" | "secret",
    },
    onSubmit: async ({ value }) => safeSubmit(createEnvVarMutation.mutateAsync(value)),
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
              <Field data-invalid={errorMessage ? true : undefined}>
                <FieldLabel htmlFor="env-var-key">Key</FieldLabel>
                <Input
                  id="env-var-key"
                  placeholder="EXPO_PUBLIC_API_URL"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value.toUpperCase());
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={errorMessage ? true : undefined}
                  className="font-mono"
                />
                <FieldError>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>

        <form.Field
          name="value"
          validators={{
            onBlur: ({ value }) => {
              const result = requiredStringSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field data-invalid={errorMessage ? true : undefined}>
                <FieldLabel htmlFor="env-var-value">Value</FieldLabel>
                <Textarea
                  id="env-var-value"
                  placeholder="https://api.example.com"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={errorMessage ? true : undefined}
                  rows={3}
                  className="font-mono"
                />
                <FieldError>{errorMessage}</FieldError>
              </Field>
            );
          }}
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
                    <SelectItem value="plaintext">Plaintext — visible everywhere</SelectItem>
                    <SelectItem value="sensitive">Sensitive — masked in dashboard</SelectItem>
                    <SelectItem value="secret">Secret — hidden in dashboard, CLI only</SelectItem>
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
              <PlusIcon strokeWidth={2} data-icon="inline-start" />
              {isSubmitting ? "Creating..." : "Add variable"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const CreateEnvVarDialog = ({
  orgId,
  projectId,
  environment,
}: {
  orgId: string;
  projectId: string;
  environment: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add variable
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add environment variable</DialogTitle>
          <DialogDescription>
            Add a new variable to the {environment === "*" ? "shared" : environment} environment.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateFormContent
            orgId={orgId}
            projectId={projectId}
            environment={environment}
            onSuccess={() => {
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
