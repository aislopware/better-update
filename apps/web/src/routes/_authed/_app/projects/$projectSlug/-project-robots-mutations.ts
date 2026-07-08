import { projectRobotAccountsQueryKey, updateRobotAccount } from "@better-update/api-client/react";
import { toast } from "@better-update/ui/components/ui/sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { RobotAccountRoleValue } from "@better-update/api-client/react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";

/** The robot a pending edit dialog targets (current values seed the form). */
export interface EditTarget {
  id: string;
  name: string;
  role: RobotAccountRoleValue;
}

/** The changed-fields-only PATCH body the edit dialog submits. */
export interface RobotAccountChanges {
  name?: string;
  role?: RobotAccountRoleValue;
}

// The one robot mutation the dashboard CAN do (no key material involved):
// rename + role change via the maintainer-gated PATCH /api/robot-accounts/:id.
// Create, rotate, and revoke stay CLI-only — they mint or retire the age keypair.
export const useProjectRobotsHandlers = (projectId: string) => {
  const queryClient = useQueryClient();
  // `editTarget` survives the close animation (cleared in
  // onOpenChangeComplete) so the dialog never loses its content mid-close.
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const edit = useApiMutation({
    mutationFn: async (input: { id: string; changes: RobotAccountChanges }) =>
      updateRobotAccount(input.id, input.changes),
    onSuccess: async () => {
      setEditOpen(false);
      toast.success("Robot account updated");
      await queryClient.invalidateQueries({ queryKey: projectRobotAccountsQueryKey(projectId) });
    },
  });

  const { mutate: editMutate } = edit;

  const handleEditRequest = useCallback((target: EditTarget) => {
    setEditTarget(target);
    setEditOpen(true);
  }, []);

  const handleEditSubmit = useCallback(
    (changes: RobotAccountChanges) => {
      if (editTarget) {
        editMutate({ id: editTarget.id, changes });
      }
    },
    [editTarget, editMutate],
  );

  return {
    editTarget,
    editOpen,
    handleEditOpenChange: setEditOpen,
    handleEditClosed: useCallback(() => {
      setEditTarget(null);
    }, []),
    handleEditRequest,
    handleEditSubmit,
    isEditing: edit.isPending,
  };
};
