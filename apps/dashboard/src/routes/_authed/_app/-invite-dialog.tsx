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
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@better-update/ui/components/ui/toggle-group";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";

import { authClient } from "../../../lib/auth-client";

const emailSchema = z.string().check(z.email("Please enter a valid email"));

const InviteFormContent = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: { email: "", role: "member" },
    onSubmit: async ({ value }) => {
      const { role } = value;
      if (role !== "member" && role !== "admin") {
        return;
      }

      const { error } = await authClient.organization.inviteMember({
        email: value.email,
        role,
        organizationId: orgId,
      });

      if (error) {
        toast.error(error.message ?? "Failed to send invitation");
        return;
      }

      toast.success("Invitation sent");
      await queryClient.invalidateQueries({
        queryKey: ["org", orgId, "invitations"],
      });
      onSuccess();
    },
  });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <FieldGroup className="py-4">
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
            const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
            return (
              <Field data-invalid={errorMessage ? true : undefined}>
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
                  aria-invalid={errorMessage ? true : undefined}
                />
                <FieldError>{errorMessage}</FieldError>
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
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              <UserPlusIcon strokeWidth={2} data-icon="inline-start" />
              {isSubmitting ? "Sending..." : "Send invitation"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const InviteDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <UserPlusIcon strokeWidth={2} data-icon="inline-start" />
        Invite member
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>Send an invitation to join your organization.</DialogDescription>
        </DialogHeader>
        <InviteFormContent
          orgId={orgId}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
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
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Remove member</DialogTitle>
        <DialogDescription>
          Are you sure you want to remove this member? They will lose access to the organization
          immediately.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button variant="destructive" disabled={isRemoving} onClick={onConfirm}>
          {isRemoving ? "Removing..." : "Remove"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
