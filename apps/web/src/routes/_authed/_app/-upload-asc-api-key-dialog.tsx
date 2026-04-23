import {
  appleTeamsQueryOptions,
  ascApiKeysQueryOptions,
  uploadAscApiKey,
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

const UUID_PATTERN =
  /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/u;

export const UploadAscApiKeyDialog = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useApiMutation({
    mutationFn: uploadAscApiKey,
    onSuccess: async () => {
      toast.success("ASC API key uploaded");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ascApiKeysQueryOptions(orgId).queryKey }),
        queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
      ]);
      setOpen(false);
    },
  });

  const form = useForm({
    defaultValues: { name: "", keyId: "", issuerId: "", p8Pem: "", appleTeamIdentifier: "" },
    onSubmit: async ({ value }) => {
      const payload =
        value.appleTeamIdentifier.length > 0
          ? value
          : {
              name: value.name,
              keyId: value.keyId,
              issuerId: value.issuerId,
              p8Pem: value.p8Pem,
            };
      await safeSubmit(mutation.mutateAsync(payload));
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
          <DialogTitle>Upload App Store Connect API Key</DialogTitle>
          <DialogDescription>
            Upload an App Store Connect API key to manage devices and provisioning profiles
            programmatically.
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
              name="name"
              validators={{
                onBlur: ({ value }) => (value.length > 0 ? undefined : "Name required"),
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="asc-name">Label</FieldLabel>
                  <Input
                    id="asc-name"
                    placeholder="Primary ASC key"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                    }}
                  />
                  <FieldError>{getFieldError(field)}</FieldError>
                </Field>
              )}
            </form.Field>

            <div className="grid grid-cols-2 gap-4">
              <form.Field
                name="keyId"
                validators={{
                  onBlur: ({ value }) =>
                    /^[A-Z0-9]{10}$/u.test(value) ? undefined : "10 uppercase alphanumeric",
                }}
              >
                {(field) => (
                  <Field data-invalid={getFieldError(field) ? true : undefined}>
                    <FieldLabel htmlFor="asc-key-id">Key ID</FieldLabel>
                    <Input
                      id="asc-key-id"
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
                    value.length === 0 || /^[A-Z0-9]{10}$/u.test(value)
                      ? undefined
                      : "10 uppercase alphanumeric or leave blank",
                }}
              >
                {(field) => (
                  <Field data-invalid={getFieldError(field) ? true : undefined}>
                    <FieldLabel htmlFor="asc-team">Apple Team ID (optional)</FieldLabel>
                    <Input
                      id="asc-team"
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
            </div>

            <form.Field
              name="issuerId"
              validators={{
                onBlur: ({ value }) => (UUID_PATTERN.test(value) ? undefined : "Must be a UUID"),
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="asc-issuer">Issuer ID</FieldLabel>
                  <Input
                    id="asc-issuer"
                    placeholder="12345678-abcd-ef12-3456-7890abcdef12"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
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
                  <FieldLabel htmlFor="asc-p8">.p8 file</FieldLabel>
                  <Input
                    id="asc-p8"
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
