import { CardFrame, CardFrameHeader, CardFrameTitle } from "@better-update/ui/components/ui/card";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@better-update/ui/components/ui/tabs";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PageHeader } from "../../../components/page-header";
import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
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
  const [activeTab, setActiveTab] = useState<string>("members");

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
      toastManager.add({ title: "Role updated", type: "success" });
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
      toastManager.add({ title: "Member removed", type: "success" });
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
      toastManager.add({ title: "Invitation canceled", type: "success" });
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

  const memberPendingId =
    roleChangeMutation.isPending || removeMemberMutation.isPending
      ? (roleChangeMutation.variables?.memberId ?? removeMemberMutation.variables)
      : undefined;

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Members"
        description="Invite teammates and manage their roles within this organization."
        actions={isOwnerOrAdmin ? <InviteDialog orgId={orgId} /> : undefined}
      />

      <CardFrame>
        <CardFrameHeader>
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(String(value));
            }}
            className="w-full"
          >
            <TabsList variant="underline" className="-mb-2">
              <TabsTab value="members">
                Members
                <span className="text-muted-foreground/72 ml-1.5 tabular-nums">
                  {members.length}
                </span>
              </TabsTab>
              <TabsTab value="invitations">
                Pending invitations
                <span className="text-muted-foreground/72 ml-1.5 tabular-nums">
                  {pendingInvitations.length}
                </span>
              </TabsTab>
            </TabsList>
          </Tabs>
          <CardFrameTitle className="sr-only">
            {activeTab === "members" ? "Team members" : "Pending invitations"}
          </CardFrameTitle>
        </CardFrameHeader>
        <Tabs value={activeTab}>
          <TabsPanel value="members">
            <MembersTableView
              members={members}
              currentUserId={user.id}
              currentRole={currentRole}
              pendingMemberId={memberPendingId}
              onRoleChange={handleRoleChange}
              onRemove={setRemoveMemberId}
            />
          </TabsPanel>
          <TabsPanel value="invitations">
            {pendingInvitations.length === 0 ? (
              <p className="text-muted-foreground p-6 text-center text-sm">
                No pending invitations.
              </p>
            ) : (
              <InvitationsTableView
                invitations={pendingInvitations}
                pendingInvitationId={
                  cancelInvitationMutation.isPending
                    ? cancelInvitationMutation.variables
                    : undefined
                }
                onCancel={handleCancelInvitation}
              />
            )}
          </TabsPanel>
        </Tabs>
      </CardFrame>

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
