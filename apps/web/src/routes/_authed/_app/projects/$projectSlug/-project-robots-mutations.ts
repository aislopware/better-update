import { projectRobotAccountsQueryKey, updateRobotAccount } from "@better-update/api-client/react";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { RobotAccountItem, RobotAccountRoleValue } from "@better-update/api-client/react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";

/** The robot a pending rename dialog targets. */
export interface RenameTarget {
  id: string;
  name: string;
}

// Robot mutations the dashboard CAN do (no key material involved): rename +
// role change via the maintainer-gated PATCH /api/robot-accounts/:id. Create,
// rotate, and revoke stay CLI-only — they mint or retire the age keypair.
export const useProjectRobotsHandlers = (projectId: string) => {
  const queryClient = useQueryClient();
  // `renameTarget` survives the close animation (cleared in
  // onOpenChangeComplete) so the dialog never loses its content mid-close.
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);

  const updateRole = useApiMutation({
    mutationFn: async (input: { id: string; role: RobotAccountRoleValue }) =>
      updateRobotAccount(input.id, { role: input.role }),
    onSuccess: async () => {
      toastManager.add({ title: "Role updated", type: "success" });
      await queryClient.invalidateQueries({ queryKey: projectRobotAccountsQueryKey(projectId) });
    },
  });

  const rename = useApiMutation({
    mutationFn: async (input: { id: string; name: string }) =>
      updateRobotAccount(input.id, { name: input.name }),
    onSuccess: async () => {
      setRenameOpen(false);
      toastManager.add({ title: "Robot renamed", type: "success" });
      await queryClient.invalidateQueries({ queryKey: projectRobotAccountsQueryKey(projectId) });
    },
  });

  const { mutate: updateRoleMutate } = updateRole;
  const { mutate: renameMutate } = rename;

  const handleRoleChange = useCallback(
    (robot: RobotAccountItem, role: RobotAccountRoleValue) => {
      updateRoleMutate({ id: robot.id, role });
    },
    [updateRoleMutate],
  );

  const handleRenameRequest = useCallback((target: RenameTarget) => {
    setRenameTarget(target);
    setRenameOpen(true);
  }, []);

  const handleRename = useCallback(
    (name: string) => {
      if (renameTarget) {
        renameMutate({ id: renameTarget.id, name });
      }
    },
    [renameTarget, renameMutate],
  );

  const rolePendingId = updateRole.isPending ? updateRole.variables.id : undefined;
  const renamePendingId = rename.isPending ? rename.variables.id : undefined;

  return {
    renameTarget,
    renameOpen,
    handleRenameOpenChange: setRenameOpen,
    handleRenameClosed: useCallback(() => {
      setRenameTarget(null);
    }, []),
    handleRenameRequest,
    handleRename,
    handleRoleChange,
    pendingRobotId: rolePendingId ?? renamePendingId,
    isRenaming: rename.isPending,
  };
};
