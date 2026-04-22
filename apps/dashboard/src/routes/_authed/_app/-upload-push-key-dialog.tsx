import {
  applePushKeysQueryOptions,
  appleTeamsQueryOptions,
  uploadApplePushKey,
} from "@better-update/api-client/react";
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
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getFieldError } from "../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../lib/use-api-mutation";
import { safeReadFileAsText } from "./-credentials-utils";

export const UploadPushKeyDialog = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useApiMutation({
    mutationFn: uploadApplePushKey,
    onSuccess: async () => {
      toast.success("Push key uploaded");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applePushKeysQueryOptions(orgId).queryKey }),
        queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
      ]);
      setOpen(false);
    },
  });

  const form = useForm({
    defaultValues: { keyId: "", p8Pem: "", appleTeamIdentifier: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(mutation.mutateAsync(value));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Upload
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload APNs Push Key</DialogTitle>
          <DialogDescription>
            Upload a .p8 APNs authentication key. Push keys can be reused across apps in the same
            Apple Team.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            await form.handleSubmit();
          }}
        >
          <div className="flex flex-col gap-4 py-2">
            <form.Field
              name="keyId"
              validators={{
                onBlur: ({ value }) =>
                  /^[A-Z0-9]{10}$/u.test(value) ? undefined : "Must be 10 uppercase alphanumeric",
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="push-key-id">Key ID</FieldLabel>
                  <Input
                    id="push-key-id"
                    placeholder="ABCDE12345"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value.toUpperCase());
                    }}
                  />
                  <FieldError>{getFieldError(field)}</FieldError>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="appleTeamIdentifier"
              validators={{
                onBlur: ({ value }) =>
                  /^[A-Z0-9]{10}$/u.test(value) ? undefined : "Must be 10 uppercase alphanumeric",
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="push-key-team">Apple Team ID</FieldLabel>
                  <Input
                    id="push-key-team"
                    placeholder="ABCDE12345"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value.toUpperCase());
                    }}
                  />
                  <FieldError>{getFieldError(field)}</FieldError>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="p8Pem"
              validators={{
                onChange: ({ value }) =>
                  value.includes("BEGIN PRIVATE KEY") ? undefined : ".p8 PEM required",
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="push-key-p8">.p8 file</FieldLabel>
                  <Input
                    id="push-key-p8"
                    type="file"
                    accept=".p8,text/plain"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file === undefined) {
                        return;
                      }
                      const value = await safeReadFileAsText(file);
                      if (value === null) {
                        toast.error("Failed to read file");
                        return;
                      }
                      field.handleChange(value);
                    }}
                  />
                  <Textarea
                    readOnly
                    value={field.state.value}
                    rows={4}
                    className="mt-2 font-mono text-xs"
                    placeholder="PEM content will appear here after file selection"
                  />
                  <FieldError>{getFieldError(field)}</FieldError>
                </Field>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Uploading..." : "Upload"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
