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
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@better-update/ui/components/ui/toggle-group";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod/v4";

import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
import { getFieldError } from "../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../lib/use-api-mutation";

const emailSchema = z.string().check(z.email("Please enter a valid email"));

const InviteFormContent = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();

  const inviteMutation = useApiMutation({
    mutationFn: async (input: { email: string; role: "member" | "admin" }) =>
      rejectOnAuthClientError(
        authClient.organization.inviteMember({
          email: input.email,
          role: input.role,
          organizationId: orgId,
        }),
        "Failed to send invitation",
      ),
    onSuccess: async () => {
      toastManager.add({ title: "Invitation sent", type: "success" });
      await queryClient.invalidateQueries({
        queryKey: ["org", orgId, "invitations"],
      });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { email: "", role: "member" },
    onSubmit: async ({ value }) => {
      const { role } = value;
      if (role !== "member" && role !== "admin") {
        return;
      }
      await safeSubmit(inviteMutation.mutateAsync({ email: value.email, role }));
    },
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
      <DialogPanel>
        <FieldGroup>
          <form.Field
            name="email"
            validators={{
              onBlur: ({ value }) => {
                const result = emailSchema.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <Field invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@example.com"
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

          <form.Field name="role">
            {(field) => (
              <Field>
                <FieldLabel>Role</FieldLabel>
                <ToggleGroup
                  value={[field.state.value]}
                  onValueChange={(value) => {
                    const [next] = value;
                    if (next) {
                      field.handleChange(next);
                    }
                  }}
                >
                  <ToggleGroupItem value="member">Member</ToggleGroupItem>
                  <ToggleGroupItem value="admin">Admin</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-muted-foreground text-xs">
                  {field.state.value === "admin"
                    ? "Admins can invite people and manage projects."
                    : "Members can view projects but cannot manage them."}
                </p>
              </Field>
            )}
          </form.Field>
        </FieldGroup>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              <UserPlusIcon strokeWidth={2} data-icon="inline-start" />
              Send invitation
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const InviteDialog = ({ orgId }: { orgId: string }) => {
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
        <UserPlusIcon strokeWidth={2} data-icon="inline-start" />
        Invite member
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>Send an invitation to join your organization.</DialogDescription>
        </DialogHeader>
        <InviteFormContent
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

export const RemoveDialog = ({
  open,
  onOpenChange,
  onConfirm,
  isRemoving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isRemoving: boolean;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Remove member</DialogTitle>
        <DialogDescription>
          Are you sure you want to remove this member? They will lose access to the organization
          immediately.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button variant="destructive" loading={isRemoving} onClick={onConfirm}>
          Remove
        </Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>
);
