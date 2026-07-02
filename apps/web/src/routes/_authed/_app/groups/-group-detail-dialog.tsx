import {
  addGroupMember,
  attachPolicyToGroup,
  detachPolicyFromGroup,
  groupMembersQueryKey,
  groupMembersQueryOptions,
  groupPoliciesQueryKey,
  groupPoliciesQueryOptions,
  removeGroupMember,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
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
import { Separator } from "@better-update/ui/components/ui/separator";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import type { GroupItem, GroupMemberItem } from "@better-update/api-client/react";

import { PolicyAttachPanel } from "../-policy-attach-panel";
import { EntityAvatar } from "../../../../lib/entity-avatar";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { membersQueryOptions } from "../../../../queries/org";

import type { MemberItem } from "../../../../queries/org";

const GroupMembersList = ({
  groupMembers,
  isLoading,
  memberById,
  removingMemberId,
  onRemove,
}: {
  groupMembers: readonly GroupMemberItem[];
  isLoading: boolean;
  memberById: ReadonlyMap<string, MemberItem>;
  removingMemberId: string | undefined;
  onRemove: (memberId: string) => void;
}) => {
  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
        <Spinner />
        Loading members…
      </div>
    );
  }
  if (groupMembers.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm">No members in this group yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {groupMembers.map((member) => {
        const orgMember = memberById.get(member.memberId);
        return (
          <li
            key={member.memberId}
            className="border-border flex items-center justify-between rounded-md border px-3 py-2"
          >
            <span className="flex items-center gap-2.5">
              <EntityAvatar
                name={orgMember?.user.name ?? member.memberId}
                image={orgMember?.user.image}
                className="size-7"
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {orgMember?.user.name ?? member.memberId}
                </span>
                {orgMember ? (
                  <span className="text-muted-foreground truncate text-xs">
                    {orgMember.user.email}
                  </span>
                ) : null}
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Remove member"
              loading={removingMemberId === member.memberId}
              onClick={() => {
                onRemove(member.memberId);
              }}
            >
              <XIcon className="size-4" strokeWidth={2} />
            </Button>
          </li>
        );
      })}
    </ul>
  );
};

const GroupMembersSection = ({ orgId, group }: { orgId: string; group: GroupItem }) => {
  const queryClient = useQueryClient();
  const [selectedMemberId, setSelectedMemberId] = useState("");

  const { data: orgMembers = [] } = useQuery(membersQueryOptions(orgId));
  const { data: membersData, isLoading } = useQuery(groupMembersQueryOptions(orgId, group.id));
  const groupMembers = useMemo(() => membersData?.items ?? [], [membersData]);

  const memberById = useMemo(() => {
    const map = new Map<string, MemberItem>();
    orgMembers.forEach((member) => {
      map.set(member.id, member);
    });
    return map;
  }, [orgMembers]);

  const memberIdsInGroup = useMemo(
    () => new Set(groupMembers.map((member) => member.memberId)),
    [groupMembers],
  );
  const availableMembers = useMemo(
    () => orgMembers.filter((member) => !memberIdsInGroup.has(member.id)),
    [orgMembers, memberIdsInGroup],
  );

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: groupMembersQueryKey(orgId, group.id) });
  };

  const addMutation = useApiMutation({
    mutationFn: async (memberId: string) => addGroupMember(group.id, { memberId }),
    onSuccess: async () => {
      toastManager.add({ title: "Member added", type: "success" });
      setSelectedMemberId("");
      await invalidate();
    },
  });

  const removeMutation = useApiMutation({
    mutationFn: async (memberId: string) => removeGroupMember(group.id, memberId),
    onSuccess: async () => {
      toastManager.add({ title: "Member removed", type: "success" });
      await invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel>Member</FieldLabel>
          <Select
            value={selectedMemberId}
            onValueChange={(next) => {
              if (next !== null) {
                setSelectedMemberId(next);
              }
            }}
            disabled={availableMembers.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a member to add" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {availableMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.user.name} ({member.user.email})
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </Field>
        <Button
          loading={addMutation.isPending}
          disabled={selectedMemberId === ""}
          onClick={() => {
            if (selectedMemberId !== "") {
              addMutation.mutate(selectedMemberId);
            }
          }}
        >
          Add member
        </Button>
      </div>

      <GroupMembersList
        groupMembers={groupMembers}
        isLoading={isLoading}
        memberById={memberById}
        removingMemberId={removeMutation.isPending ? removeMutation.variables : undefined}
        onRemove={(memberId) => {
          removeMutation.mutate(memberId);
        }}
      />
    </div>
  );
};

// The group is the team mechanism: policies attached to the group (managed
// admin or custom) are inherited by every group member.
const GroupAccessSection = ({ orgId, group }: { orgId: string; group: GroupItem }) => {
  const { data, isLoading } = useQuery(groupPoliciesQueryOptions(orgId, group.id));
  return (
    <PolicyAttachPanel
      orgId={orgId}
      attachments={data?.items ?? []}
      isLoading={isLoading}
      attachmentsQueryKey={groupPoliciesQueryKey(orgId, group.id)}
      onAttach={async (body) => attachPolicyToGroup(group.id, body)}
      onDetach={async (policyId) => detachPolicyFromGroup(group.id, policyId)}
    />
  );
};

const SectionHeading = ({ children }: { children: string }) => (
  <h3 className="text-sm font-semibold">{children}</h3>
);

export const GroupDetailDialog = ({
  orgId,
  group,
  open,
  onOpenChange,
}: {
  orgId: string;
  group: GroupItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{group.name}</DialogTitle>
        <DialogDescription>
          Manage the members of this group and the access every group member inherits.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="flex flex-col gap-5">
        <Suspense
          fallback={
            <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
              <Spinner />
              Loading…
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            <SectionHeading>Members</SectionHeading>
            <GroupMembersSection orgId={orgId} group={group} />
          </div>
          <Separator />
          <div className="flex flex-col gap-3">
            <SectionHeading>Access</SectionHeading>
            <GroupAccessSection orgId={orgId} group={group} />
          </div>
        </Suspense>
      </DialogPanel>
    </DialogPopup>
  </Dialog>
);
