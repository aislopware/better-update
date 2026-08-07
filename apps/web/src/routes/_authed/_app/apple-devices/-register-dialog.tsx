import { devicesQueryKey, registerDevice } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/dialog";
import { Field } from "@better-update/ui/components/field";
import { FieldGroup } from "@better-update/ui/components/field-layout";
import { Input } from "@better-update/ui/components/input";
import { toast } from "@better-update/ui/components/toast";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod/v4";

import type { DeviceClassValue } from "@better-update/api-client/react";

import { deviceNameSchema as nameSchema, getFieldError } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { APPLE_TEAM_NONE, AppleTeamField } from "./-apple-team-field";

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
  <SelectContent>
    <SelectGroup>
      {DEVICE_CLASS_OPTIONS.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
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
    <SelectTrigger className="w-full" aria-label="Device class">
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
  appleTeamId: string;
}

const DEFAULTS: FormValues = {
  identifier: "",
  name: "",
  deviceClass: "IPHONE",
  model: "",
  appleTeamId: APPLE_TEAM_NONE,
};

const RegisterDeviceForm = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();

  const registerMutation = useApiMutation({
    mutationFn: async (value: FormValues) =>
      registerDevice({
        identifier: value.identifier.trim().toLowerCase(),
        name: value.name.trim(),
        deviceClass: value.deviceClass,
        ...(value.model.trim() ? { model: value.model.trim() } : {}),
        ...(value.appleTeamId === APPLE_TEAM_NONE ? {} : { appleTeamId: value.appleTeamId }),
      }),
    onSuccess: async () => {
      toast.success("Device registered");
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
      <FieldGroup>
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
              <Input
                label="UDID"
                description="40 hex chars (legacy) · 8-16 hex (modern iOS) · UUID (Mac)."
                error={errorMessage}
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
              <Input
                label="Name"
                error={errorMessage}
                id="device-name"
                placeholder="Alex's iPhone 15 Pro"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>

        <form.Field name="deviceClass">
          {(field) => (
            <Field label="Class">
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
            <Input
              label="Model (optional)"
              id="device-model"
              placeholder="iPhone 15 Pro"
              value={field.state.value}
              onChange={(event) => {
                field.handleChange(event.target.value);
              }}
            />
          )}
        </form.Field>

        <form.Field name="appleTeamId">
          {(field) => (
            <AppleTeamField
              orgId={orgId}
              value={field.state.value}
              onChange={(next) => {
                field.handleChange(next);
              }}
              description="Assign this device to an Apple team for ad-hoc provisioning."
            />
          )}
        </form.Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button
              variant="primary"
              type="submit"
              disabled={!canSubmit || isSubmitting}
              loading={isSubmitting}
              icon={<PlusIcon strokeWidth={2} />}
            >
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
      <DialogTrigger render={<Button variant="primary" />}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add device
      </DialogTrigger>
      <DialogContent size="lg">
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
      </DialogContent>
    </Dialog>
  );
};
