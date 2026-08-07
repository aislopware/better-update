import {
  createRegistrationRequest,
  registrationRequestsQueryKey,
} from "@better-update/api-client/react";
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
import { Select } from "@better-update/ui/components/select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { LinkIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { z } from "zod/v4";

import type {
  DeviceClassValue,
  DeviceRegistrationRequestItem,
} from "@better-update/api-client/react";

import { CopyButton } from "../../../../lib/copy-button";
import { getFieldError, onPicked } from "../../../../lib/form-utils";
import { formatDateTime } from "../../../../lib/format-date";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { APPLE_TEAM_NONE, AppleTeamField } from "./-apple-team-field";

const hintNameSchema = z.string().check(z.maxLength(120, "Max 120 characters"));

const TTL_OPTIONS = [
  { value: "1", label: "1 hour" },
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
];

const DEVICE_CLASS_OPTIONS: { value: DeviceClassValue | "NONE"; label: string }[] = [
  { value: "NONE", label: "No hint" },
  { value: "IPHONE", label: "iPhone" },
  { value: "IPAD", label: "iPad" },
  { value: "MAC", label: "Mac" },
];

interface FormValues {
  deviceNameHint: string;
  deviceClassHint: DeviceClassValue | "NONE";
  appleTeamId: string;
  ttlHours: string;
}

const DEFAULTS: FormValues = {
  deviceNameHint: "",
  deviceClassHint: "NONE",
  appleTeamId: APPLE_TEAM_NONE,
  ttlHours: "24",
};

const ShareInvite = ({
  invite,
  onClose,
}: {
  invite: DeviceRegistrationRequestItem;
  onClose: () => void;
}) => (
  <>
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-center rounded-xl border bg-white p-4">
        <QRCodeSVG value={invite.url} size={192} marginSize={2} />
      </div>
      <Field
        label="Invite link"
        description={
          <>
            Expires {formatDateTime(invite.expiresAt)}. Open on iOS Safari to install the profile.
          </>
        }
      >
        <InputGroup>
          <InputGroupInput
            readOnly
            aria-label="Invite link"
            value={invite.url}
            className="font-mono text-xs"
          />
          <InputGroupAddon align="inline-end">
            <CopyButton value={invite.url} label="Invite link" size="xs" />
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </div>
    <DialogFooter>
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    </DialogFooter>
  </>
);

const CreateInviteForm = ({
  orgId,
  onInviteCreated,
}: {
  orgId: string;
  onInviteCreated: (invite: DeviceRegistrationRequestItem) => void;
}) => {
  const queryClient = useQueryClient();

  const createMutation = useApiMutation({
    mutationFn: async (value: FormValues) =>
      createRegistrationRequest({
        ttlHours: Number.parseInt(value.ttlHours, 10),
        ...(value.deviceNameHint.trim() ? { deviceNameHint: value.deviceNameHint.trim() } : {}),
        ...(value.deviceClassHint === "NONE" ? {} : { deviceClassHint: value.deviceClassHint }),
        ...(value.appleTeamId === APPLE_TEAM_NONE ? {} : { appleTeamId: value.appleTeamId }),
      }),
    onSuccess: async (result) => {
      onInviteCreated(result);
      await queryClient.invalidateQueries({
        queryKey: registrationRequestsQueryKey(orgId),
      });
    },
  });

  const form = useForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => safeSubmit(createMutation.mutateAsync(value)),
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
          name="deviceNameHint"
          validators={{
            onBlur: ({ value }) => {
              const result = hintNameSchema.safeParse(value.trim());
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Input
                label="Device name hint (optional)"
                description="Shown on the landing page. Device owner can override."
                error={errorMessage}
                id="invite-name"
                placeholder="Alex's iPhone"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>

        <form.Field name="deviceClassHint">
          {(field) => (
            <Select
              label="Device class"
              required={false}
              placeholder="No hint"
              className="w-full"
              items={DEVICE_CLASS_OPTIONS}
              value={field.state.value}
              onValueChange={onPicked((next: FormValues["deviceClassHint"]) => {
                field.handleChange(next);
              })}
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
              description="The enrolled device is assigned to this Apple team."
            />
          )}
        </form.Field>

        <form.Field name="ttlHours">
          {(field) => (
            <Select
              label="Expires after"
              className="w-full"
              items={TTL_OPTIONS}
              value={field.state.value}
              onValueChange={onPicked((next: FormValues["ttlHours"]) => {
                field.handleChange(next);
              })}
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
            >
              Generate link
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const InviteDeviceDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<DeviceRegistrationRequestItem | null>(null);
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setInvite(null);
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogTrigger render={<Button variant="secondary" />}>
        <LinkIcon strokeWidth={2} data-icon="inline-start" />
        Invite link
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{invite ? "Share invite link" : "Create invite link"}</DialogTitle>
          <DialogDescription>
            {invite
              ? "Share the link or QR code with the device owner. They open it in iOS Safari and install the profile."
              : "Generate a one-time link that registers an Apple device via Safari + Configuration Profile — no UDID lookup required."}
          </DialogDescription>
        </DialogHeader>

        {invite ? (
          <ShareInvite
            invite={invite}
            onClose={() => {
              setOpen(false);
            }}
          />
        ) : (
          <CreateInviteForm key={resetKey} orgId={orgId} onInviteCreated={setInvite} />
        )}
      </DialogContent>
    </Dialog>
  );
};
