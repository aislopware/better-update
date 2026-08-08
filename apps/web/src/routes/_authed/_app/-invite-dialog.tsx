import { createInvitation } from "@better-update/api-client/react";
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
import { FieldGroup } from "@better-update/ui/components/field-layout";
import { Input } from "@better-update/ui/components/input";
import { Select } from "@better-update/ui/components/select";
import { toast } from "@better-update/ui/components/toast";
import { UserPlusIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod/v4";

import type { ProjectMemberRoleValue } from "@better-update/api-client/react";

import { getFieldError, onPicked } from "../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../lib/use-api-mutation";
import { invitationsQueryOptions } from "../../../queries/org";
import { ProjectGrantsSection } from "./-invite-project-access";

import type { ProjectGrantDraft } from "./-invite-project-access";

// The project-access building blocks live in -invite-project-access.tsx;
// existing importers keep reaching them through this module.
export { PROJECT_ROLE_LABELS } from "./-invite-project-access";
export type { ProjectGrantDraft } from "./-invite-project-access";

const emailSchema = z.string().check(z.email("Please enter a valid email"));

export type InviteOrgRole = "member" | "admin";

const ORG_ROLE_LABELS: Record<InviteOrgRole, string> = { member: "Member", admin: "Admin" };

// What the chosen role actually gets you, said under the control that chooses
// it. This used to be one sentence at the foot of the form, two controls below
// the select it describes and directly under the project list it contradicted.
const ORG_ROLE_HINTS: Record<InviteOrgRole, string> = {
  member: "Sees only the projects granted below.",
  admin: "Manages the organization and holds Maintainer access on every project.",
};

// Pure payload builder (unit-tested): drops rows where no project was picked
// and omits `projects` / `allProjectsRole` entirely when nothing was granted,
// so the API sees the same body the CLI would send.
//
// An admin is a Maintainer on every project by virtue of being an admin, so
// grants alongside that role describe nothing — the form stops offering them
// once admin is picked, and any rows filled in beforehand are dropped here
// rather than written as memberships that change no one's access.
export const buildInvitationPayload = (
  email: string,
  role: InviteOrgRole,
  grants: readonly ProjectGrantDraft[],
  allProjectsRole: ProjectMemberRoleValue | null = null,
): Parameters<typeof createInvitation>[0] => {
  if (role === "admin") {
    return { email, role };
  }
  const projects = grants.flatMap((grant) =>
    grant.projectId ? [{ projectId: grant.projectId, role: grant.role }] : [],
  );
  return {
    email,
    role,
    ...(projects.length === 0 ? {} : { projects }),
    ...(allProjectsRole === null ? {} : { allProjectsRole }),
  };
};

const InviteFormContent = ({
  orgId,
  isOwner,
  canGrantAllProjects,
  onSuccess,
}: {
  orgId: string;
  isOwner: boolean;
  canGrantAllProjects: boolean;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();

  // Admin is grantable at invite time only by the owner (server guard mirrors
  // this — the option simply never renders for non-owners).
  const orgRoleItems = isOwner ? ORG_ROLE_LABELS : { member: ORG_ROLE_LABELS.member };
  const [orgRole, setOrgRole] = useState<InviteOrgRole>("member");
  const [grants, setGrants] = useState<readonly ProjectGrantDraft[]>([]);
  const [allProjectsRole, setAllProjectsRole] = useState<ProjectMemberRoleValue | null>(null);

  const addGrant = (): void => {
    setGrants((prev) => [
      ...prev,
      { key: (prev.at(-1)?.key ?? 0) + 1, projectId: null, role: "developer" },
    ]);
  };
  const changeGrant = (
    key: number,
    patch: Partial<Pick<ProjectGrantDraft, "projectId" | "role">>,
  ): void => {
    setGrants((prev) => prev.map((grant) => (grant.key === key ? { ...grant, ...patch } : grant)));
  };
  const removeGrant = (key: number): void => {
    setGrants((prev) => prev.filter((grant) => grant.key !== key));
  };

  const inviteMutation = useApiMutation({
    mutationFn: async (input: Parameters<typeof createInvitation>[0]) => createInvitation(input),
    onSuccess: async () => {
      toast.success("Invitation sent");
      await queryClient.invalidateQueries({
        queryKey: invitationsQueryOptions(orgId).queryKey,
      });
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(
        inviteMutation.mutateAsync(
          buildInvitationPayload(value.email, orgRole, grants, allProjectsRole),
        ),
      );
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
              <Input
                label="Email address"
                error={errorMessage}
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={field.state.value}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                }}
                onBlur={field.handleBlur}
              />
            );
          }}
        </form.Field>

        <Select
          label="Organization role"
          description={ORG_ROLE_HINTS[orgRole]}
          className="w-full"
          value={orgRole}
          items={orgRoleItems}
          onValueChange={onPicked(setOrgRole)}
        />

        {/* Nothing to grant an admin: the role already carries Maintainer on
            every project, so the picker only ever offered access they had. */}
        {orgRole === "admin" ? null : (
          <ProjectGrantsSection
            orgId={orgId}
            grants={grants}
            allProjectsRole={allProjectsRole}
            canGrantAllProjects={canGrantAllProjects}
            onAllProjectsChange={setAllProjectsRole}
            onAdd={addGrant}
            onChange={changeGrant}
            onRemove={removeGrant}
          />
        )}
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button
              variant="primary"
              type="submit"
              disabled={!canSubmit || Boolean(isSubmitting)}
              loading={Boolean(isSubmitting)}
              icon={<UserPlusIcon weight="bold" />}
            >
              Send invitation
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const InviteDialog = ({
  orgId,
  isOwner,
  canGrantAllProjects,
}: {
  orgId: string;
  isOwner: boolean;
  canGrantAllProjects: boolean;
}) => {
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
        <UserPlusIcon weight="bold" data-icon="inline-start" />
        Invite member
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>Send an invitation to join your organization.</DialogDescription>
        </DialogHeader>
        <InviteFormContent
          key={resetKey}
          orgId={orgId}
          isOwner={isOwner}
          canGrantAllProjects={canGrantAllProjects}
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
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <Button variant="destructive" onClick={onConfirm} loading={isRemoving}>
          Remove
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
