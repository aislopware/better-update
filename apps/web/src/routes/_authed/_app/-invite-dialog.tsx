import { createInvitation, projectsQueryOptions } from "@better-update/api-client/react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod/v4";

import type { ProjectMemberRoleValue } from "@better-update/api-client/react";

import { getFieldError } from "../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../queries/constants";
import { invitationsQueryOptions } from "../../../queries/org";

const emailSchema = z.string().check(z.email("Please enter a valid email"));

export type InviteOrgRole = "member" | "admin";

const ORG_ROLE_LABELS: Record<InviteOrgRole, string> = { member: "Member", admin: "Admin" };

export const PROJECT_ROLE_LABELS: Record<ProjectMemberRoleValue, string> = {
  maintainer: "Maintainer",
  developer: "Developer",
  reporter: "Reporter",
};

const isProjectRole = (value: string): value is ProjectMemberRoleValue =>
  value in PROJECT_ROLE_LABELS;

const isInviteOrgRole = (value: string): value is InviteOrgRole =>
  value === "member" || value === "admin";

/** One draft (project, role) grant row in the invite form. */
export interface ProjectGrantDraft {
  key: number;
  projectId: string | null;
  role: ProjectMemberRoleValue;
}

// Pure payload builder (unit-tested): drops rows where no project was picked
// and omits `projects` entirely when no grant survives, so the API sees the
// same body the CLI would send.
export const buildInvitationPayload = (
  email: string,
  role: InviteOrgRole,
  grants: readonly ProjectGrantDraft[],
): Parameters<typeof createInvitation>[0] => {
  const projects = grants.flatMap((grant) =>
    grant.projectId ? [{ projectId: grant.projectId, role: grant.role }] : [],
  );
  return projects.length === 0 ? { email, role } : { email, role, projects };
};

const SelectField = ({
  label,
  ariaLabel,
  value,
  items,
  placeholder,
  className,
  onChange,
}: {
  label?: string;
  ariaLabel?: string;
  value: string | null;
  items: Record<string, string>;
  placeholder?: string;
  className?: string;
  onChange: (next: string) => void;
}) => (
  <Field className={className}>
    {label === undefined ? null : <FieldLabel>{label}</FieldLabel>}
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger className="w-full" aria-label={ariaLabel ?? label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Object.entries(items).map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  </Field>
);

const ProjectGrantRow = ({
  grant,
  projectItems,
  onChange,
  onRemove,
}: {
  grant: ProjectGrantDraft;
  projectItems: Record<string, string>;
  onChange: (patch: Partial<Pick<ProjectGrantDraft, "projectId" | "role">>) => void;
  onRemove: () => void;
}) => (
  <div className="flex items-start gap-2">
    <SelectField
      ariaLabel="Project"
      value={grant.projectId}
      items={projectItems}
      placeholder="Select a project"
      className="min-w-0 flex-1"
      onChange={(next) => {
        onChange({ projectId: next });
      }}
    />
    <SelectField
      ariaLabel="Project role"
      value={grant.role}
      items={PROJECT_ROLE_LABELS}
      className="w-36"
      onChange={(next) => {
        if (isProjectRole(next)) {
          onChange({ role: next });
        }
      }}
    />
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground/70 hover:text-destructive"
      aria-label="Remove project access"
      onClick={onRemove}
    >
      <Trash2Icon strokeWidth={2} className="size-4" />
    </Button>
  </div>
);

const ProjectGrantsSection = ({
  grants,
  projectItems,
  onAdd,
  onChange,
  onRemove,
}: {
  grants: readonly ProjectGrantDraft[];
  projectItems: Record<string, string>;
  onAdd: () => void;
  onChange: (key: number, patch: Partial<Pick<ProjectGrantDraft, "projectId" | "role">>) => void;
  onRemove: (key: number) => void;
}) => (
  <div className="flex flex-col gap-2">
    <span className="text-sm font-medium">Project access (optional)</span>
    {grants.map((grant) => (
      <ProjectGrantRow
        key={grant.key}
        grant={grant}
        projectItems={projectItems}
        onChange={(patch) => {
          onChange(grant.key, patch);
        }}
        onRemove={() => {
          onRemove(grant.key);
        }}
      />
    ))}
    <Button type="button" variant="outline" size="sm" className="self-start" onClick={onAdd}>
      <PlusIcon strokeWidth={2} data-icon="inline-start" />
      Add project
    </Button>
  </div>
);

const InviteFormContent = ({
  orgId,
  isOwner,
  onSuccess,
}: {
  orgId: string;
  isOwner: boolean;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();

  const { data: projectsResult } = useQuery(
    projectsQueryOptions(orgId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const projectItems = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        (projectsResult?.items ?? []).map((project) => [project.id, project.name]),
      ),
    [projectsResult],
  );

  // Admin is grantable at invite time only by the owner (server guard mirrors
  // this — the option simply never renders for non-owners).
  const orgRoleItems = isOwner ? ORG_ROLE_LABELS : { member: ORG_ROLE_LABELS.member };
  const [orgRole, setOrgRole] = useState<InviteOrgRole>("member");
  const [grants, setGrants] = useState<readonly ProjectGrantDraft[]>([]);

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
        inviteMutation.mutateAsync(buildInvitationPayload(value.email, orgRole, grants)),
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
              <Field data-invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@example.com"
                  aria-invalid={Boolean(errorMessage) || undefined}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
              </Field>
            );
          }}
        </form.Field>

        <SelectField
          label="Organization role"
          value={orgRole}
          items={orgRoleItems}
          onChange={(next) => {
            if (isInviteOrgRole(next)) {
              setOrgRole(next);
            }
          }}
        />

        <ProjectGrantsSection
          grants={grants}
          projectItems={projectItems}
          onAdd={addGrant}
          onChange={changeGrant}
          onRemove={removeGrant}
        />

        <p className="text-muted-foreground text-xs">
          {orgRole === "admin"
            ? "Admins manage the organization and hold Maintainer access on every project."
            : "Members see only the projects granted here; you can grant more after they join."}
        </p>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || Boolean(isSubmitting)}>
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UserPlusIcon strokeWidth={2} data-icon="inline-start" />
              )}
              Send invitation
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const InviteDialog = ({ orgId, isOwner }: { orgId: string; isOwner: boolean }) => {
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>Send an invitation to join your organization.</DialogDescription>
        </DialogHeader>
        <InviteFormContent
          key={resetKey}
          orgId={orgId}
          isOwner={isOwner}
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
          {isRemoving && <Spinner data-icon="inline-start" />}
          Remove
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
