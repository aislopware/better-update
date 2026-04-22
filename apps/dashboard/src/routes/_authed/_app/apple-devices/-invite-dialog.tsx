import {
  createRegistrationRequest,
  registrationRequestsQueryKey,
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
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
import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";

import type {
  DeviceClassValue,
  DeviceRegistrationRequestItem,
} from "@better-update/api-client/react";

import { getFieldError } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";

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

const TtlOptions = () => (
  <SelectContent>
    <SelectGroup>
      {TTL_OPTIONS.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
);

const DeviceClassHintSelect = ({
  value,
  onChange,
}: {
  value: FormValues["deviceClassHint"];
  onChange: (next: FormValues["deviceClassHint"]) => void;
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
      <SelectValue placeholder="No hint" />
    </SelectTrigger>
    <DeviceClassOptions />
  </Select>
);

const TtlSelect = ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
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
      <SelectValue />
    </SelectTrigger>
    <TtlOptions />
  </Select>
);

interface FormValues {
  deviceNameHint: string;
  deviceClassHint: DeviceClassValue | "NONE";
  ttlHours: string;
}

const DEFAULTS: FormValues = {
  deviceNameHint: "",
  deviceClassHint: "NONE",
  ttlHours: "24",
};

const ShareInvite = ({
  invite,
  onClose,
}: {
  invite: DeviceRegistrationRequestItem;
  onClose: () => void;
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(invite.url);
    setCopied(true);
    toast.success("Link copied");
    globalThis.setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex items-center justify-center rounded-lg border bg-white p-4">
        <QRCodeSVG value={invite.url} size={192} marginSize={2} />
      </div>
      <Field>
        <FieldLabel>Invite link</FieldLabel>
        <div className="flex items-center gap-2">
          <Input readOnly value={invite.url} className="font-mono text-xs" />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy link"
            onClick={async () => {
              await handleCopy();
            }}
          >
            {copied ? (
              <CheckIcon strokeWidth={2} className="size-4" />
            ) : (
              <CopyIcon strokeWidth={2} className="size-4" />
            )}
          </Button>
        </div>
        <FieldDescription>
          Expires {new Date(invite.expiresAt).toLocaleString()}. Open on iOS Safari to install the
          profile.
        </FieldDescription>
      </Field>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </div>
  );
};

export const InviteDeviceDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState<DeviceRegistrationRequestItem | null>(null);
  const queryClient = useQueryClient();

  const createMutation = useApiMutation({
    mutationFn: async (value: FormValues) =>
      createRegistrationRequest({
        ttlHours: Number.parseInt(value.ttlHours, 10),
        ...(value.deviceNameHint.trim() ? { deviceNameHint: value.deviceNameHint.trim() } : {}),
        ...(value.deviceClassHint === "NONE" ? {} : { deviceClassHint: value.deviceClassHint }),
      }),
    onSuccess: async (result) => {
      setInvite(result);
      await queryClient.invalidateQueries({
        queryKey: registrationRequestsQueryKey(orgId),
      });
    },
  });

  const form = useForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => safeSubmit(createMutation.mutateAsync(value)),
  });

  const handleClose = () => {
    setOpen(false);
    setInvite(null);
    form.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          handleClose();
          return;
        }
        setOpen(true);
      }}
    >
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <LinkIcon strokeWidth={2} data-icon="inline-start" />
        Invite link
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{invite ? "Share invite link" : "Create invite link"}</DialogTitle>
          <DialogDescription>
            {invite
              ? "Share the link or QR code with the device owner. They open it in iOS Safari and install the profile."
              : "Generate a one-time link that registers an Apple device via Safari + Configuration Profile — no UDID lookup required."}
          </DialogDescription>
        </DialogHeader>

        {invite ? (
          <ShareInvite invite={invite} onClose={handleClose} />
        ) : (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              await form.handleSubmit();
            }}
          >
            <FieldGroup className="py-4">
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
                    <Field data-invalid={errorMessage ? true : undefined}>
                      <FieldLabel htmlFor="invite-name">Device name hint (optional)</FieldLabel>
                      <Input
                        id="invite-name"
                        placeholder="Alex's iPhone"
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                        }}
                        onBlur={field.handleBlur}
                      />
                      <FieldDescription>
                        Shown on the landing page. Device owner can override.
                      </FieldDescription>
                      <FieldError>{errorMessage}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field name="deviceClassHint">
                {(field) => (
                  <Field>
                    <FieldLabel>Device class (optional)</FieldLabel>
                    <DeviceClassHintSelect
                      value={field.state.value}
                      onChange={(next) => {
                        field.handleChange(next);
                      }}
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="ttlHours">
                {(field) => (
                  <Field>
                    <FieldLabel>Expires after</FieldLabel>
                    <TtlSelect
                      value={field.state.value}
                      onChange={(next) => {
                        field.handleChange(next);
                      }}
                    />
                  </Field>
                )}
              </form.Field>
            </FieldGroup>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
                {([canSubmit, isSubmitting]) => (
                  <Button type="submit" disabled={!canSubmit || isSubmitting}>
                    {isSubmitting ? "Generating..." : "Generate link"}
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
