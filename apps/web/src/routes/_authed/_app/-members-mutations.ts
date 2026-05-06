import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { authClient, rejectOnAuthClientError } from "../../../lib/auth-client";
import { useApiMutation } from "../../../lib/use-api-mutation";

export type OrgRole = "member" | "admin" | "owner";

export const isOrgRole = (value: string): value is OrgRole =>
  value === "member" || value === "admin" || value === "owner";

const useMembersMutations = (orgId: string, onMemberRemoved: () => void) => {
  const queryClient = useQueryClient();

  const roleChange = useApiMutation({
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

  const removeMember = useApiMutation({
    mutationFn: async (memberId: string) =>
      rejectOnAuthClientError(
        authClient.organization.removeMember({
          memberIdOrEmail: memberId,
          organizationId: orgId,
        }),
        "Failed to remove member",
      ),
    onSuccess: async () => {
      onMemberRemoved();
      toastManager.add({ title: "Member removed", type: "success" });
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "members"] });
    },
  });

  const cancelInvitation = useApiMutation({
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

  return { roleChange, removeMember, cancelInvitation };
};

export const useMembersHandlers = (orgId: string) => {
  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);

  const handleMemberRemoved = useCallback(() => {
    setRemoveMemberId(null);
  }, []);

  const { roleChange, removeMember, cancelInvitation } = useMembersMutations(
    orgId,
    handleMemberRemoved,
  );

  const { mutate: roleChangeMutate } = roleChange;
  const { mutate: removeMemberMutate } = removeMember;
  const { mutate: cancelInvitationMutate } = cancelInvitation;

  const handleRoleChange = useCallback(
    (memberId: string, role: string) => {
      if (!isOrgRole(role)) {
        return;
      }
      roleChangeMutate({ memberId, role });
    },
    [roleChangeMutate],
  );

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

  const memberPendingId =
    roleChange.isPending || removeMember.isPending
      ? (roleChange.variables?.memberId ?? removeMember.variables)
      : undefined;
  const invitationPendingId = cancelInvitation.isPending ? cancelInvitation.variables : undefined;

  return {
    removeMemberId,
    setRemoveMemberId,
    handleRoleChange,
    handleRemove,
    handleCancelInvitation,
    memberPendingId,
    invitationPendingId,
    isRemoving: removeMember.isPending,
  };
};
