import {
  projectMembersQueryKey,
  removeProjectMember,
  updateProjectMemberRole,
} from "@better-update/api-client/react";
import { toast } from "@better-update/ui/components/ui/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { ProjectMemberRoleValue } from "@better-update/api-client/react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";

/** The principal a pending remove confirmation targets. */
export interface RemoveTarget {
  principalId: string;
  name: string;
}

// Project-membership mutations (GITLAB-RBAC-SPEC §4c): role change + removal
// via the maintainer-gated /api/projects/:id/members routes. Adding goes
// through the Add-member dialog's own mutation.
export const useProjectMembersHandlers = (projectId: string) => {
  const queryClient = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);

  const updateRole = useApiMutation({
    mutationFn: async (input: { principalId: string; role: ProjectMemberRoleValue }) =>
      updateProjectMemberRole(projectId, input.principalId, {
        principalType: "member",
        role: input.role,
      }),
    onSuccess: async () => {
      toast.success("Role updated");
      await queryClient.invalidateQueries({ queryKey: projectMembersQueryKey(projectId) });
    },
  });

  const remove = useApiMutation({
    mutationFn: async (input: { principalId: string }) =>
      removeProjectMember(projectId, input.principalId, "member"),
    onSuccess: async () => {
      setRemoveTarget(null);
      toast.success("Member removed from project");
      await queryClient.invalidateQueries({ queryKey: projectMembersQueryKey(projectId) });
    },
  });

  const { mutate: updateRoleMutate } = updateRole;
  const { mutate: removeMutate } = remove;

  const handleRoleChange = useCallback(
    (principalId: string, role: ProjectMemberRoleValue) => {
      updateRoleMutate({ principalId, role });
    },
    [updateRoleMutate],
  );

  const handleRemove = useCallback(() => {
    if (removeTarget) {
      removeMutate({ principalId: removeTarget.principalId });
    }
  }, [removeTarget, removeMutate]);

  const rolePendingId = updateRole.isPending ? updateRole.variables.principalId : undefined;
  const removePendingId = remove.isPending ? remove.variables.principalId : undefined;
  const pendingPrincipalId = rolePendingId ?? removePendingId;

  return {
    removeTarget,
    setRemoveTarget,
    handleRoleChange,
    handleRemove,
    pendingPrincipalId,
    isRemoving: remove.isPending,
  };
};
