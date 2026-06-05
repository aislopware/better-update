import { devicesQueryKey, registerDevice } from "@better-update/api-client/react";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod/v4";

import type { DeviceClassValue } from "@better-update/api-client/react";

import { deviceNameSchema as nameSchema, getFieldError } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

const IDENTIFIER_PATTERN =
  /^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{16}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/u;

const identifierSchema = z
  .string()
  .check(
    z.minLength(1, "UDID is required"),
    z.regex(IDENTIFIER_PATTERN, "Not a valid Apple UDID (40 hex, 8-16 hex, or UUID format)"),
  );

const MAC_UUID = /^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/u;

const inferClass = (value: string): DeviceClassValue | null => {
  const trimmed = value.trim();
  if (!IDENTIFIER_PATTERN.test(trimmed)) {
    return null;
  }
  if (MAC_UUID.test(trimmed)) {
    return "MAC";
  }
  return "IPHONE";
};

const DEVICE_CLASS_OPTIONS: { value: DeviceClassValue; label: string }[] = [
  { value: "IPHONE", label: "iPhone" },
  { value: "IPAD", label: "iPad" },
  { value: "MAC", label: "Mac" },
  { value: "UNKNOWN", label: "Unknown" },
];

const DeviceClassOptions = () => (
  <SelectPopup>
    <SelectGroup>
      {DEVICE_CLASS_OPTIONS.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectPopup>
);

const DeviceClassField = ({
  value,
  onChange,
}: {
  value: DeviceClassValue;
  onChange: (next: DeviceClassValue) => void;
}) => (
  <Select
    value={value}
    onValueChange={(next) => {
      if (next === null) {
        return;
      }
      onChange(next);
    }}
  >
    <SelectTrigger>
      <SelectValue placeholder="Select class" />
    </SelectTrigger>
    <DeviceClassOptions />
  </Select>
);

interface FormValues {
  identifier: string;
  name: string;
  deviceClass: DeviceClassValue;
  model: string;
}

const DEFAULTS: FormValues = { identifier: "", name: "", deviceClass: "IPHONE", model: "" };

const RegisterDeviceForm = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();

  const registerMutation = useApiMutation({
    mutationFn: async (value: FormValues) =>
      registerDevice({
        identifier: value.identifier.trim().toLowerCase(),
        name: value.name.trim(),
        deviceClass: value.deviceClass,
        ...(value.model.trim() ? { model: value.model.trim() } : {}),
      }),
    onSuccess: async () => {
      toastManager.add({ title: "Device registered", type: "success" });
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey(orgId) });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => safeSubmit(registerMutation.mutateAsync(value)),
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
          name="identifier"
          validators={{
            onBlur: ({ value }) => {
              const result = identifierSchema.safeParse(value.trim());
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="device-identifier">UDID</FieldLabel>
                <Input
                  id="device-identifier"
                  placeholder="00008030-001C45663C90802E"
                  value={field.state.value}
                  onChange={(event) => {
                    const next = event.target.value;
                    field.handleChange(next);
                    const inferred = inferClass(next);
                    if (inferred !== null) {
                      form.setFieldValue("deviceClass", inferred, {
                        dontUpdateMeta: true,
                        dontValidate: true,
                      });
                    }
                  }}
                  onBlur={field.handleBlur}
                  className="font-mono"
                />
                <FieldDescription>
                  40 hex chars (legacy) · 8-16 hex (modern iOS) · UUID (Mac).
                </FieldDescription>
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>

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
                <FieldLabel htmlFor="device-name">Name</FieldLabel>
                <Input
                  id="device-name"
                  placeholder="Alex's iPhone 15 Pro"
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

        <form.Field name="deviceClass">
          {(field) => (
            <Field>
              <FieldLabel>Class</FieldLabel>
              <DeviceClassField
                value={field.state.value}
                onChange={(next) => {
                  field.handleChange(next);
                }}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="model">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="device-model">Model (optional)</FieldLabel>
              <Input
                id="device-model"
                placeholder="iPhone 15 Pro"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
              />
            </Field>
          )}
        </form.Field>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={isSubmitting}>
              <PlusIcon strokeWidth={2} data-icon="inline-start" />
              Register device
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const RegisterDeviceDialog = ({ orgId }: { orgId: string }) => {
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
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add device
      </Button>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Register a device</DialogTitle>
          <DialogDescription>
            Register an Apple device UDID for ad-hoc provisioning. Find the UDID in Xcode &gt;
            Window &gt; Devices and Simulators.
          </DialogDescription>
        </DialogHeader>
        <RegisterDeviceForm
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
