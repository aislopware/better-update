import { devicesQueryKey, updateDevice } from "@better-update/api-client/react";
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
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { DeviceItem } from "@better-update/api-client/react";
import type { ReactElement } from "react";

import { deviceNameSchema as nameSchema, getFieldError } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

const RenameForm = ({
  orgId,
  device,
  onSuccess,
}: {
  orgId: string;
  device: DeviceItem;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();

  const renameMutation = useApiMutation({
    mutationFn: async (value: { name: string }) => updateDevice(device.id, { name: value.name }),
    onSuccess: async () => {
      toastManager.add({ title: "Device renamed", type: "success" });
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { name: device.name },
    onSubmit: async ({ value }) =>
      safeSubmit(renameMutation.mutateAsync({ name: value.name.trim() })),
  });

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <DialogPanel className="grid gap-4">
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
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="device-rename">Name</FieldLabel>
                <Input
                  id="device-rename"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={isSubmitting}>
              Save
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const RenameDeviceDialog = ({
  orgId,
  device,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  orgId: string;
  device: DeviceItem;
  children?: ReactElement;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) => {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };

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
      {children ? <DialogTrigger render={children} /> : null}
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Rename device</DialogTitle>
          <DialogDescription>Give this device a clearer label.</DialogDescription>
        </DialogHeader>
        <RenameForm
          key={resetKey}
          orgId={orgId}
          device={device}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
