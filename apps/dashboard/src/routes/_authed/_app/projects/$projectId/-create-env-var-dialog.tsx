import { getApiError } from "@better-update/api-client";
import { createEnvVar } from "@better-update/api-client/react";
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
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";

const keySchema = z
  .string()
  .check(
    z.minLength(1, "Key is required"),
    z.maxLength(256, "Key must be at most 256 characters"),
    z.regex(/^[A-Z][A-Z0-9_]*$/, "Must be uppercase letters, digits, and underscores"),
  );

const valueSchema = z.string().check(z.minLength(1, "Value is required"));

const RESERVED_KEYS = new Set(["PATH", "HOME", "USER", "SHELL"]);

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

  const form = useForm({
    defaultValues: {
      key: "",
      value: "",
      visibility: "plaintext" as "plaintext" | "sensitive" | "secret",
    },
    onSubmit: async ({ value }) => {
      // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
      try {
        await createEnvVar({
          projectId,
          environment,
          key: value.key,
          value: value.value,
          visibility: value.visibility,
        });
      } catch (error) {
        toast.error(getApiError(error));
        return;
      }

      toast.success(`Variable "${value.key}" created`);
      await queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "env-vars"],
      });
      onSuccess();
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
      <div className="flex flex-col gap-4 py-4">
        <form.Field
          name="key"
          validators={{
            onBlur: ({ value }) => {
              const result = keySchema.safeParse(value);
              if (!result.success) {
                return result.error.issues[0]?.message;
              }
              if (RESERVED_KEYS.has(value)) {
                return `"${value}" is a reserved key`;
              }
              return undefined;
            },
          }}
        >
          {(field) => {
            const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
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
              const result = valueSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
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
                  if (val) {
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
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
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
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
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
