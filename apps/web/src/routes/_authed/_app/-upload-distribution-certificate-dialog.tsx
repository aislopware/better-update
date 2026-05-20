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
  DialogTrigger,
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
import { dateToIsoBoundary, isoToDate, safeReadFileAsBase64 } from "./-credentials-utils";

const UploadForm = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();

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
      onSuccess();
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
              <Field invalid={Boolean(getFieldError(field))}>
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
                <FieldError match={Boolean(getFieldError(field))}>
                  {getFieldError(field)}
                </FieldError>
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
              <Field invalid={Boolean(getFieldError(field))}>
                <FieldLabel htmlFor="dist-cert-password">Archive password</FieldLabel>
                <Input
                  id="dist-cert-password"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                />
                <FieldError match={Boolean(getFieldError(field))}>
                  {getFieldError(field)}
                </FieldError>
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
              <Field invalid={Boolean(getFieldError(field))}>
                <FieldLabel htmlFor="dist-cert-team">Apple Team ID</FieldLabel>
                <Input
                  id="dist-cert-team"
                  placeholder="ABCDE12345"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value.toUpperCase());
                  }}
                />
                <FieldError match={Boolean(getFieldError(field))}>
                  {getFieldError(field)}
                </FieldError>
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
              <Field invalid={Boolean(getFieldError(field))}>
                <FieldLabel htmlFor="dist-cert-serial">Serial number</FieldLabel>
                <Input
                  id="dist-cert-serial"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                />
                <FieldError match={Boolean(getFieldError(field))}>
                  {getFieldError(field)}
                </FieldError>
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
                <Field invalid={Boolean(getFieldError(field))}>
                  <FieldLabel>Valid from</FieldLabel>
                  <DatePicker
                    value={isoToDate(field.state.value)}
                    onChange={(value) => {
                      field.handleChange(dateToIsoBoundary(value, "start"));
                    }}
                  />
                  <FieldError match={Boolean(getFieldError(field))}>
                    {getFieldError(field)}
                  </FieldError>
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
                <Field invalid={Boolean(getFieldError(field))}>
                  <FieldLabel>Valid until</FieldLabel>
                  <DatePicker
                    value={isoToDate(field.state.value)}
                    onChange={(value) => {
                      field.handleChange(dateToIsoBoundary(value, "end"));
                    }}
                  />
                  <FieldError match={Boolean(getFieldError(field))}>
                    {getFieldError(field)}
                  </FieldError>
                </Field>
              )}
            </form.Field>
          </div>
        </FieldGroup>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              Upload
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const UploadDistributionCertificateDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Upload
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Upload Distribution Certificate</DialogTitle>
          <DialogDescription>
            Upload a .p12 Apple Distribution Certificate. Password decrypts the archive; metadata
            identifies the cert in your Apple Team.
          </DialogDescription>
        </DialogHeader>
        <UploadForm
          key={resetKey}
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
