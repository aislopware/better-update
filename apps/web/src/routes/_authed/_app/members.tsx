import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
import { pluralize } from "../../../lib/pluralize";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { invitationsQueryOptions, membersQueryOptions } from "../../../queries/org";
import { InviteDialog, RemoveDialog } from "./-invite-dialog";
import { InvitationsTableView, MembersTableView } from "./-members-table";

type OrgRole = "member" | "admin" | "owner";

const isOrgRole = (value: string): value is OrgRole =>
  value === "member" || value === "admin" || value === "owner";

const Members = () => {
  const queryClient = useQueryClient();
  const { activeOrg, user } = Route.useRouteContext();
  const orgId = activeOrg.id;

  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  const { data: invitations } = useSuspenseQuery(invitationsQueryOptions(orgId));

  const currentMember = members.find((member) => member.userId === user.id);
  const currentRole = currentMember?.role ?? "member";
  const isOwnerOrAdmin = currentRole === "owner" || currentRole === "admin";

  const pendingInvitations = useMemo(
    () => invitations.filter((inv) => inv.status === "pending"),
    [invitations],
  );

  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const roleChangeMutation = useApiMutation({
    mutationFn: async (input: { memberId: string; role: OrgRole }) =>
      rejectOnAuthClientError(
        authClient.organization.updateMemberRole({
          memberId: input.memberId,
          role: input.role,
          organizationId: orgId,
        }),
        "Failed to update role",
      ),
    onSuccess: async () => {
      toast.success("Role updated");
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "members"] });
    },
  });

  const removeMemberMutation = useApiMutation({
    mutationFn: async (memberId: string) =>
      rejectOnAuthClientError(
        authClient.organization.removeMember({
          memberIdOrEmail: memberId,
          organizationId: orgId,
        }),
        "Failed to remove member",
      ),
    onSuccess: async () => {
      setRemoveMemberId(null);
      toast.success("Member removed");
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "members"] });
    },
  });

  const cancelInvitationMutation = useApiMutation({
    mutationFn: async (invitationId: string) =>
      rejectOnAuthClientError(
        authClient.organization.cancelInvitation({ invitationId }),
        "Failed to cancel invitation",
      ),
    onSuccess: async () => {
      toast.success("Invitation canceled");
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "invitations"] });
    },
  });

  const handleRoleChange = (memberId: string, role: string) => {
    if (!isOrgRole(role)) {
      return;
    }
    roleChangeMutation.mutate({ memberId, role });
  };

  const handleRemove = () => {
    if (!removeMemberId) {
      return;
    }
    removeMemberMutation.mutate(removeMemberId);
  };

  const handleCancelInvitation = (invitationId: string) => {
    cancelInvitationMutation.mutate(invitationId);
  };

  return (
    <div className="flex w-full flex-col gap-4">
      {isOwnerOrAdmin ? (
        <div className="flex justify-end">
          <InviteDialog orgId={orgId} />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>
            <span className="tabular-nums">{members.length}</span>{" "}
            {pluralize(members.length, "member")} in this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersTableView
            members={members}
            currentUserId={user.id}
            currentRole={currentRole}
            pendingMemberId={
              roleChangeMutation.isPending || removeMemberMutation.isPending
                ? (roleChangeMutation.variables?.memberId ?? removeMemberMutation.variables)
                : undefined
            }
            onRoleChange={handleRoleChange}
            onRemove={setRemoveMemberId}
          />
        </CardContent>
      </Card>

      {pendingInvitations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>
              <span className="tabular-nums">{pendingInvitations.length}</span> pending{" "}
              {pluralize(pendingInvitations.length, "invitation")}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvitationsTableView
              invitations={pendingInvitations}
              pendingInvitationId={
                cancelInvitationMutation.isPending ? cancelInvitationMutation.variables : undefined
              }
              onCancel={handleCancelInvitation}
            />
          </CardContent>
        </Card>
      ) : null}

      <RemoveDialog
        open={removeMemberId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setRemoveMemberId(null);
          }
        }}
        onConfirm={handleRemove}
        isRemoving={removeMemberMutation.isPending}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/members")({
  component: Members,
});
