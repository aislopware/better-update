import {
  appleDistributionCertificatesQueryOptions,
  appleTeamsQueryOptions,
  uploadAppleDistributionCertificate,
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
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { getFieldError } from "../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../lib/use-api-mutation";
import { safeReadFileAsBase64 } from "./-credentials-utils";

export const UploadDistributionCertificateDialog = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useApiMutation({
    mutationFn: uploadAppleDistributionCertificate,
    onSuccess: async () => {
      toast.success("Distribution certificate uploaded");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: appleDistributionCertificatesQueryOptions(orgId).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: appleTeamsQueryOptions(orgId).queryKey }),
      ]);
      setOpen(false);
    },
  });

  const form = useForm({
    defaultValues: {
      p12Base64: "",
      p12Password: "",
      serialNumber: "",
      appleTeamIdentifier: "",
      validFrom: "",
      validUntil: "",
    },
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
          <DialogTitle>Upload Distribution Certificate</DialogTitle>
          <DialogDescription>
            Upload a .p12 Apple Distribution Certificate. Password decrypts the archive; metadata
            identifies the cert in your Apple Team.
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
              name="p12Base64"
              validators={{
                onChange: ({ value }) => (value.length > 0 ? undefined : ".p12 file required"),
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="dist-cert-file">.p12 file</FieldLabel>
                  <Input
                    id="dist-cert-file"
                    type="file"
                    accept=".p12,application/x-pkcs12"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file === undefined) {
                        return;
                      }
                      const value = await safeReadFileAsBase64(file);
                      if (value === null) {
                        toast.error("Failed to read file");
                        return;
                      }
                      field.handleChange(value);
                    }}
                  />
                  <FieldError>{getFieldError(field)}</FieldError>
                </Field>
              )}
            </form.Field>

            <form.Field
              name="p12Password"
              validators={{
                onBlur: ({ value }) => (value.length > 0 ? undefined : "Password required"),
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="dist-cert-password">Archive password</FieldLabel>
                  <Input
                    id="dist-cert-password"
                    type="password"
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
              name="appleTeamIdentifier"
              validators={{
                onBlur: ({ value }) =>
                  /^[A-Z0-9]{10}$/u.test(value) ? undefined : "Must be 10 uppercase alphanumeric",
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="dist-cert-team">Apple Team ID</FieldLabel>
                  <Input
                    id="dist-cert-team"
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
              name="serialNumber"
              validators={{
                onBlur: ({ value }) => (value.length > 0 ? undefined : "Serial required"),
              }}
            >
              {(field) => (
                <Field data-invalid={getFieldError(field) ? true : undefined}>
                  <FieldLabel htmlFor="dist-cert-serial">Serial number</FieldLabel>
                  <Input
                    id="dist-cert-serial"
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
                name="validFrom"
                validators={{
                  onBlur: ({ value }) => (value.length > 0 ? undefined : "Required"),
                }}
              >
                {(field) => (
                  <Field data-invalid={getFieldError(field) ? true : undefined}>
                    <FieldLabel htmlFor="dist-cert-valid-from">Valid from</FieldLabel>
                    <Input
                      id="dist-cert-valid-from"
                      type="date"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(
                          event.target.value ? `${event.target.value}T00:00:00.000Z` : "",
                        );
                      }}
                    />
                    <FieldError>{getFieldError(field)}</FieldError>
                  </Field>
                )}
              </form.Field>
              <form.Field
                name="validUntil"
                validators={{
                  onBlur: ({ value }) => (value.length > 0 ? undefined : "Required"),
                }}
              >
                {(field) => (
                  <Field data-invalid={getFieldError(field) ? true : undefined}>
                    <FieldLabel htmlFor="dist-cert-valid-until">Valid until</FieldLabel>
                    <Input
                      id="dist-cert-valid-until"
                      type="date"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(
                          event.target.value ? `${event.target.value}T23:59:59.000Z` : "",
                        );
                      }}
                    />
                    <FieldError>{getFieldError(field)}</FieldError>
                  </Field>
                )}
              </form.Field>
            </div>
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
