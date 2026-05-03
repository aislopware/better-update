import {
  googleServiceAccountKeysQueryOptions,
  uploadGoogleServiceAccountKey,
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
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { getFieldError } from "../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../lib/use-api-mutation";
import { safeReadFileAsText } from "./-credentials-utils";

export const UploadGoogleServiceAccountKeyDialog = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useApiMutation({
    mutationFn: uploadGoogleServiceAccountKey,
    onSuccess: async () => {
      toastManager.add({ title: "Service account key uploaded", type: "success" });
      await queryClient.invalidateQueries({
        queryKey: googleServiceAccountKeysQueryOptions(orgId).queryKey,
      });
      setOpen(false);
    },
  });

  const form = useForm({
    defaultValues: { json: "" },
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
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Upload Google Service Account Key</DialogTitle>
          <DialogDescription>
            Upload a .json Google service account key for FCM v1 push or Play Store submissions.
          </DialogDescription>
        </DialogHeader>
        <form
          className="contents"
          onSubmit={async (event) => {
            event.preventDefault();
            await form.handleSubmit();
          }}
        >
          <DialogPanel>
            <FieldGroup>
              <form.Field
                name="json"
                validators={{
                  onChange: ({ value }) =>
                    value.includes('"private_key"') ? undefined : "Valid JSON key required",
                }}
              >
                {(field) => (
                  <Field data-invalid={getFieldError(field) ? true : undefined}>
                    <FieldLabel htmlFor="google-sa-file">Key file</FieldLabel>
                    <Input
                      id="google-sa-file"
                      type="file"
                      accept="application/json,.json"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (file === undefined) {
                          return;
                        }
                        const value = await safeReadFileAsText(file);
                        if (value === null) {
                          toastManager.add({ title: "Failed to read file", type: "error" });
                          return;
                        }
                        field.handleChange(value);
                      }}
                    />
                    <Textarea
                      readOnly
                      value={field.state.value}
                      rows={5}
                      className="mt-2 font-mono text-xs"
                      placeholder="JSON content will appear here after file selection"
                    />
                    <FieldError>{getFieldError(field)}</FieldError>
                  </Field>
                )}
              </form.Field>
            </FieldGroup>
          </DialogPanel>
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
      </DialogPopup>
    </Dialog>
  );
};
