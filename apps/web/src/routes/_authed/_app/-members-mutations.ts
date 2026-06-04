import {
  cancelInvitation as cancelInvitationRequest,
  removeMember as removeMemberRequest,
} from "@better-update/api-client/react";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useApiMutation } from "../../../lib/use-api-mutation";
import { invitationsQueryOptions, membersQueryOptions } from "../../../queries/org";

const useMembersMutations = (orgId: string, onMemberRemoved: () => void) => {
  const queryClient = useQueryClient();

  // Removal goes through the IAM-gated DELETE /api/members/:id endpoint
  // (member:delete; last-owner guard server-side), not better-auth's
  // organization.removeMember. Role changes are gone: admin/developer/viewer
  // powers are policy attachments now, managed via the per-member dialog.
  const removeMember = useApiMutation({
    mutationFn: async (memberId: string) => removeMemberRequest(memberId),
    onSuccess: async () => {
      onMemberRemoved();
      toastManager.add({ title: "Member removed", type: "success" });
      await queryClient.invalidateQueries({ queryKey: membersQueryOptions(orgId).queryKey });
    },
  });

  const cancelInvitation = useApiMutation({
    mutationFn: async (invitationId: string) => cancelInvitationRequest(invitationId),
    onSuccess: async () => {
      toastManager.add({ title: "Invitation canceled", type: "success" });
      await queryClient.invalidateQueries({ queryKey: invitationsQueryOptions(orgId).queryKey });
    },
  });

  return { removeMember, cancelInvitation };
};

export const useMembersHandlers = (orgId: string) => {
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const handleMemberRemoved = useCallback(() => {
    setRemoveMemberId(null);
  }, []);

  const { removeMember, cancelInvitation } = useMembersMutations(orgId, handleMemberRemoved);

  const { mutate: removeMemberMutate } = removeMember;
  const { mutate: cancelInvitationMutate } = cancelInvitation;

  const handleRemove = useCallback(() => {
    if (removeMemberId) {
      removeMemberMutate(removeMemberId);
    }
  }, [removeMemberId, removeMemberMutate]);

  const handleCancelInvitation = useCallback(
    (invitationId: string) => {
      cancelInvitationMutate(invitationId);
    },
    [cancelInvitationMutate],
  );

  const memberPendingId = removeMember.isPending ? removeMember.variables : undefined;
  const invitationPendingId = cancelInvitation.isPending ? cancelInvitation.variables : undefined;

  return {
    removeMemberId,
    setRemoveMemberId,
    handleRemove,
    handleCancelInvitation,
    memberPendingId,
    invitationPendingId,
    isRemoving: removeMember.isPending,
  };
};
