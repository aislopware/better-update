import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Separator } from "@better-update/ui/components/ui/separator";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
import { useApiMutation } from "../../../lib/use-api-mutation";
import { orgsQueryOptions, sessionQueryOptions } from "../../../queries/auth";
import { invitationsQueryOptions, membersQueryOptions } from "../../../queries/org";
import { InviteDialog, RemoveDialog } from "./-invite-dialog";
import { InvitationsTableView, MembersTableView } from "./-members-table";

const Members = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const activeOrgId = session?.session.activeOrganizationId ?? "";
  const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? orgs[0];
  const orgId = activeOrg?.id ?? "";

  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  const { data: invitations } = useSuspenseQuery(invitationsQueryOptions(orgId));

  const currentMember = members.find((member) => member.userId === session?.user.id);
  const currentRole = currentMember?.role ?? "member";
  const isOwnerOrAdmin = currentRole === "owner" || currentRole === "admin";

  const pendingInvitations = useMemo(
    () => invitations.filter((inv) => inv.status === "pending"),
    [invitations],
  );

  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const roleChangeMutation = useApiMutation({
    mutationFn: async (input: { memberId: string; role: "member" | "admin" | "owner" }) =>
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
    if (role !== "member" && role !== "admin" && role !== "owner") {
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
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Members</h1>
          <p className="text-muted-foreground mt-1">Manage who has access to your organization.</p>
        </div>
        {isOwnerOrAdmin ? <InviteDialog orgId={orgId} /> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>
            {members.length} {members.length === 1 ? "member" : "members"} in this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersTableView
            members={members}
            currentUserId={session?.user.id ?? ""}
            currentRole={currentRole}
            onRoleChange={handleRoleChange}
            onRemove={setRemoveMemberId}
          />
        </CardContent>
      </Card>

      {pendingInvitations.length > 0 ? (
        <>
          <Separator />
          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
              <CardDescription>
                {pendingInvitations.length} pending{" "}
                {pendingInvitations.length === 1 ? "invitation" : "invitations"}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InvitationsTableView
                invitations={pendingInvitations}
                onCancel={handleCancelInvitation}
              />
            </CardContent>
          </Card>
        </>
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
