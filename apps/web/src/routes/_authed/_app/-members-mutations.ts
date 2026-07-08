import {
  cancelInvitation as cancelInvitationRequest,
  removeMember as removeMemberRequest,
  updateMemberRole as updateMemberRoleRequest,
} from "@better-update/api-client/react";
import { toast } from "@better-update/ui/components/ui/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useApiMutation } from "../../../lib/use-api-mutation";
import { invitationsQueryOptions, membersQueryOptions } from "../../../queries/org";

import type { EditableOrgRole } from "./-members-table";

const useMembersMutations = (orgId: string, onMemberRemoved: () => void) => {
  const queryClient = useQueryClient();

  // Removal goes through the IAM-gated DELETE /api/members/:id endpoint
  // (member:delete; last-owner guard server-side), not better-auth's
  // organization.removeMember.
  const removeMember = useApiMutation({
    mutationFn: async (memberId: string) => removeMemberRequest(memberId),
    onSuccess: async () => {
      onMemberRemoved();
      toast.success("Member removed");
      await queryClient.invalidateQueries({ queryKey: membersQueryOptions(orgId).queryKey });
    },
  });

  // Org role change (GITLAB-RBAC-SPEC §2): admin ⇄ member via the IAM-gated
  // PATCH /api/members/:id. Granting/revoking admin is owner-only server-side;
  // the UI only offers the select to owners.
  const updateMemberRole = useApiMutation({
    mutationFn: async (input: { memberId: string; role: EditableOrgRole }) =>
      updateMemberRoleRequest(input.memberId, input.role),
    onSuccess: async () => {
      toast.success("Role updated");
      await queryClient.invalidateQueries({ queryKey: membersQueryOptions(orgId).queryKey });
    },
  });

  const cancelInvitation = useApiMutation({
    mutationFn: async (invitationId: string) => cancelInvitationRequest(invitationId),
    onSuccess: async () => {
      toast.success("Invitation canceled");
      await queryClient.invalidateQueries({ queryKey: invitationsQueryOptions(orgId).queryKey });
    },
  });

  return { removeMember, updateMemberRole, cancelInvitation };
};

export const useMembersHandlers = (orgId: string) => {
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const handleMemberRemoved = useCallback(() => {
    setRemoveMemberId(null);
  }, []);

  const { removeMember, updateMemberRole, cancelInvitation } = useMembersMutations(
    orgId,
    handleMemberRemoved,
  );

  const { mutate: removeMemberMutate } = removeMember;
  const { mutate: updateMemberRoleMutate } = updateMemberRole;
  const { mutate: cancelInvitationMutate } = cancelInvitation;

  const handleRemove = useCallback(() => {
    if (removeMemberId) {
      removeMemberMutate(removeMemberId);
    }
  }, [removeMemberId, removeMemberMutate]);

  const handleRoleChange = useCallback(
    (memberId: string, role: EditableOrgRole) => {
      updateMemberRoleMutate({ memberId, role });
    },
    [updateMemberRoleMutate],
  );

  const handleCancelInvitation = useCallback(
    (invitationId: string) => {
      cancelInvitationMutate(invitationId);
    },
    [cancelInvitationMutate],
  );

  const memberPendingId = removeMember.isPending ? removeMember.variables : undefined;
  const rolePendingId = updateMemberRole.isPending
    ? updateMemberRole.variables.memberId
    : undefined;
  const invitationPendingId = cancelInvitation.isPending ? cancelInvitation.variables : undefined;

  return {
    removeMemberId,
    setRemoveMemberId,
    handleRemove,
    handleRoleChange,
    handleCancelInvitation,
    memberPendingId,
    rolePendingId,
    invitationPendingId,
    isRemoving: removeMember.isPending,
  };
};
