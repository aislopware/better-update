import { getApiError } from "@better-update/api-client";
import { updateEnvVar } from "@better-update/api-client/react";
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
import { toast } from "sonner";

import type { EnvVar } from "@better-update/api";

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

  const form = useForm({
    defaultValues: {
      value: isEncrypted ? "" : (envVar.value ?? ""),
      visibility: envVar.visibility,
    },
    onSubmit: async ({ value }) => {
      const payload: { value?: string; visibility?: "plaintext" | "sensitive" | "secret" } = {};
      if (value.value) {
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

      // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
      try {
        await updateEnvVar(envVar.id, payload);
      } catch (error) {
        toast.error(getApiError(error));
        return;
      }

      toast.success(`Variable "${envVar.key}" updated`);
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
        <div className="flex flex-col gap-2">
          <Label>Key</Label>
          <Input value={envVar.key} disabled className="font-mono" />
        </div>

        <form.Field name="value">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="env-var-value">Value</Label>
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
            </div>
          )}
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
                  <SelectItem value="plaintext">Plaintext</SelectItem>
                  <SelectItem value="sensitive">Sensitive</SelectItem>
                  <SelectItem value="secret">Secret</SelectItem>
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
