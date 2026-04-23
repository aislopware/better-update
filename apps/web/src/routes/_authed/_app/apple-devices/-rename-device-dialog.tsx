import { devicesQueryKey, updateDevice } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { DeviceItem } from "@better-update/api-client/react";
import type { ReactElement } from "react";

import { deviceNameSchema as nameSchema, getFieldError } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

export const RenameDeviceDialog = ({
  orgId,
  device,
  children,
}: {
  orgId: string;
  device: DeviceItem;
  children: ReactElement;
}) => {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const renameMutation = useApiMutation({
    mutationFn: async (value: { name: string }) => updateDevice(device.id, { name: value.name }),
    onSuccess: async () => {
      toast.success("Device renamed");
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
      setOpen(false);
    },
  });

  const form = useForm({
    defaultValues: { name: device.name },
    onSubmit: async ({ value }) =>
      safeSubmit(renameMutation.mutateAsync({ name: value.name.trim() })),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          form.reset();
        }
      }}
    >
      <DialogTrigger render={children} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename device</DialogTitle>
          <DialogDescription>Give this device a clearer label.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <FieldGroup className="py-4">
            <form.Field
              name="name"
              validators={{
                onBlur: ({ value }) => {
                  const result = nameSchema.safeParse(value.trim());
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {(field) => {
                const errorMessage = getFieldError(field);
                return (
                  <Field data-invalid={errorMessage ? true : undefined}>
                    <FieldLabel htmlFor="device-rename">Name</FieldLabel>
                    <Input
                      id="device-rename"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={errorMessage ? true : undefined}
                    />
                    <FieldError>{errorMessage}</FieldError>
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Saving..." : "Save"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
