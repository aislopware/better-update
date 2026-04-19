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
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import {
  Select,
  SelectContent,
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
      <div className="flex flex-col gap-4 py-4">
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="env-var-key">Key</Label>
                <Input
                  id="env-var-key"
                  placeholder="EXPO_PUBLIC_API_URL"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value.toUpperCase());
                  }}
                  onBlur={field.handleBlur}
                  className="font-mono"
                />
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="env-var-value">Value</Label>
                <Textarea
                  id="env-var-value"
                  placeholder="https://api.example.com"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  rows={3}
                  className="font-mono"
                />
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
            );
          }}
        </form.Field>

        <form.Field name="visibility">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label>Visibility</Label>
              <Select
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
                  <SelectItem value="plaintext">Plaintext — visible everywhere</SelectItem>
                  <SelectItem value="sensitive">Sensitive — masked in dashboard</SelectItem>
                  <SelectItem value="secret">Secret — hidden in dashboard, CLI only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
      </div>

      <DialogFooter>
        <DialogClose>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              <PlusIcon strokeWidth={2} className="size-4" />
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
        <PlusIcon strokeWidth={2} className="size-4" />
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
