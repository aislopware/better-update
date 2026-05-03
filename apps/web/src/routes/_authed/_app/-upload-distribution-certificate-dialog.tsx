import {
  appleDistributionCertificatesQueryOptions,
  appleTeamsQueryOptions,
  uploadAppleDistributionCertificate,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { DatePicker } from "@better-update/ui/components/ui/date-picker";
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
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { getFieldError } from "../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../lib/use-api-mutation";
import { safeReadFileAsBase64 } from "./-credentials-utils";

const isoToDate = (iso: string): Date | undefined => (iso ? new Date(iso) : undefined);

const dateToIsoBoundary = (date: Date | undefined, boundary: "start" | "end"): string => {
  if (!date) {
    return "";
  }
  const utc =
    boundary === "start"
      ? Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
      : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 0);
  return new Date(utc).toISOString();
};

export const UploadDistributionCertificateDialog = ({ orgId }: { orgId: string }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useApiMutation({
    mutationFn: uploadAppleDistributionCertificate,
    onSuccess: async () => {
      toastManager.add({ title: "Distribution certificate uploaded", type: "success" });
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
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Upload Distribution Certificate</DialogTitle>
          <DialogDescription>
            Upload a .p12 Apple Distribution Certificate. Password decrypts the archive; metadata
            identifies the cert in your Apple Team.
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
                          toastManager.add({ title: "Failed to read file", type: "error" });
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
                      <FieldLabel>Valid from</FieldLabel>
                      <DatePicker
                        value={isoToDate(field.state.value)}
                        onChange={(value) => {
                          field.handleChange(dateToIsoBoundary(value, "start"));
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
                      <FieldLabel>Valid until</FieldLabel>
                      <DatePicker
                        value={isoToDate(field.state.value)}
                        onChange={(value) => {
                          field.handleChange(dateToIsoBoundary(value, "end"));
                        }}
                      />
                      <FieldError>{getFieldError(field)}</FieldError>
                    </Field>
                  )}
                </form.Field>
              </div>
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
