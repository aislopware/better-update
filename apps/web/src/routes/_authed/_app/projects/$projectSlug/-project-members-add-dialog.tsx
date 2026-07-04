import { addProjectMember, projectMembersQueryKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldLabel } from "@better-update/ui/components/ui/field";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectMemberItem, ProjectMemberRoleValue } from "@better-update/api-client/react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { membersQueryOptions } from "../../../../../queries/org";

const PROJECT_ROLE_LABELS: Record<ProjectMemberRoleValue, string> = {
  maintainer: "Maintainer",
  developer: "Developer",
  reporter: "Reporter",
};

const PROJECT_ROLE_VALUES = ["maintainer", "developer", "reporter"] as const;

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
      toastManager.add({ title: "Member added to project", type: "success" });
      await queryClient.invalidateQueries({ queryKey: projectMembersQueryKey(projectId) });
      onSuccess();
    },
  });

  return (
    <>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Member</FieldLabel>
          <Select items={principalItems} value={principalId} onValueChange={setPrincipalId}>
            <SelectTrigger aria-label="Member">
              <SelectValue placeholder="Select a member" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {principals.map((principal) => (
                  <SelectItem key={principal.id} value={principal.id}>
                    {principal.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Role</FieldLabel>
          <Select
            items={PROJECT_ROLE_LABELS}
            value={role}
            onValueChange={(next) => {
              if (next !== null) {
                setRole(next);
              }
            }}
          >
            <SelectTrigger aria-label="Project role">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {PROJECT_ROLE_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {PROJECT_ROLE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </Field>

        <p className="text-muted-foreground text-xs">{PROJECT_ROLE_HINTS[role]}</p>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          disabled={selected === undefined}
          loading={addMutation.isPending}
          onClick={() => {
            if (selected !== undefined) {
              addMutation.mutate({ principalId: selected.id, role });
            }
          }}
        >
          <UserPlusIcon strokeWidth={2} data-icon="inline-start" />
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
      <DialogTrigger render={<Button />}>
        <UserPlusIcon strokeWidth={2} data-icon="inline-start" />
        Add member
      </DialogTrigger>
      <DialogPopup>
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
      </DialogPopup>
    </Dialog>
  );
};
