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
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
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
      toast.success("Device renamed");
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
      <FieldGroup>
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
            const invalid = Boolean(errorMessage);
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="device-rename">Name</FieldLabel>
                <Input
                  id="device-rename"
                  aria-invalid={invalid || undefined}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                {invalid ? <FieldError>{errorMessage}</FieldError> : null}
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
              {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
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
      <DialogContent>
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
      </DialogContent>
    </Dialog>
  );
};
