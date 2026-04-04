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
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { UserAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
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
      <div className="flex flex-col gap-4 py-4">
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-email">Email address</Label>
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
                {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
              </div>
            );
          }}
        </form.Field>

        <form.Field name="role">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label>Role</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={field.state.value === "member" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    field.handleChange("member");
                  }}
                >
                  Member
                </Button>
                <Button
                  type="button"
                  variant={field.state.value === "admin" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    field.handleChange("admin");
                  }}
                >
                  Admin
                </Button>
              </div>
            </div>
          )}
        </form.Field>
      </div>

      <DialogFooter>
        <DialogClose>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} className="size-4" />
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
        <HugeiconsIcon icon={UserAdd01Icon} strokeWidth={2} className="size-4" />
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
  onConfirm: () => Promise<void>;
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
        <DialogClose>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button variant="destructive" disabled={isRemoving} onClick={onConfirm}>
          {isRemoving ? "Removing..." : "Remove"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
