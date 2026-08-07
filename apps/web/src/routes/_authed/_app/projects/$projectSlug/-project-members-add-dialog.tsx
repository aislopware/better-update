import { addProjectMember, projectMembersQueryKey } from "@better-update/api-client/react";
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
import { Select } from "@better-update/ui/components/select";
import { toast } from "@better-update/ui/components/toast";
import { UserPlusIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import type { ProjectMemberItem, ProjectMemberRoleValue } from "@better-update/api-client/react";

import { onPicked } from "../../../../../lib/form-utils";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { membersQueryOptions } from "../../../../../queries/org";

const PROJECT_ROLE_LABELS: Record<ProjectMemberRoleValue, string> = {
  maintainer: "Maintainer",
  developer: "Developer",
  reporter: "Reporter",
};

// Role hints mirror the GitLab ladder semantics (GITLAB-RBAC-SPEC §1).
const PROJECT_ROLE_HINTS: Record<ProjectMemberRoleValue, string> = {
  maintainer: "Full project control, incl. protected environments and member management.",
  developer: "Daily work — publish, build, submit — on non-protected environments.",
  reporter: "Read and download everything; no writes.",
};

interface PrincipalOption {
  id: string;
  label: string;
}

const AddMemberForm = ({
  projectId,
  principals,
  onSuccess,
}: {
  projectId: string;
  principals: readonly PrincipalOption[];
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const [principalId, setPrincipalId] = useState<string | null>(null);
  const [role, setRole] = useState<ProjectMemberRoleValue>("developer");

  const principalItems = useMemo<Record<string, string>>(
    () => Object.fromEntries(principals.map((principal) => [principal.id, principal.label])),
    [principals],
  );
  const selected = principals.find((principal) => principal.id === principalId);

  const addMutation = useApiMutation({
    mutationFn: async (input: { principalId: string; role: ProjectMemberRoleValue }) =>
      addProjectMember(projectId, { principalType: "member", ...input }),
    onSuccess: async () => {
      toast.success("Member added to project");
      await queryClient.invalidateQueries({ queryKey: projectMembersQueryKey(projectId) });
      onSuccess();
    },
  });

  return (
    <>
      <FieldGroup>
        <Select
          label="Member"
          placeholder="Select a member"
          className="w-full"
          items={principalItems}
          value={principalId}
          onValueChange={onPicked(setPrincipalId)}
        />

        <Select
          label="Role"
          className="w-full"
          items={PROJECT_ROLE_LABELS}
          value={role}
          onValueChange={onPicked(setRole)}
        />

        <p className="text-kumo-subtle text-xs">{PROJECT_ROLE_HINTS[role]}</p>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <Button
          variant="primary"
          disabled={selected === undefined || addMutation.isPending}
          onClick={() => {
            if (selected !== undefined) {
              addMutation.mutate({ principalId: selected.id, role });
            }
          }}
          loading={addMutation.isPending}
          icon={<UserPlusIcon weight="bold" />}
        >
          Add to project
        </Button>
      </DialogFooter>
    </>
  );
};

export const AddProjectMemberDialog = ({
  orgId,
  projectId,
  existingMembers,
}: {
  orgId: string;
  projectId: string;
  existingMembers: readonly ProjectMemberItem[];
}) => {
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const { data: orgMembers = [] } = useQuery(membersQueryOptions(orgId));

  const principals = useMemo<PrincipalOption[]>(() => {
    const taken = new Set(existingMembers.map((member) => member.principalId));
    // Org owners/admins are implicit maintainers on every project
    // (GITLAB-RBAC-SPEC §1) — a project_member row for them would be inert,
    // so only baseline members are offered.
    return orgMembers
      .filter((member) => member.role !== "owner" && member.role !== "admin")
      .map((member) => ({
        id: member.id,
        label: `${member.user.name} (${member.user.email})`,
      }))
      .filter((option) => !taken.has(option.id));
  }, [existingMembers, orgMembers]);

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
        Add member
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add a project member</DialogTitle>
          <DialogDescription>
            Grant an organization member a role on this project.
          </DialogDescription>
        </DialogHeader>
        <AddMemberForm
          key={resetKey}
          projectId={projectId}
          principals={principals}
          onSuccess={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
