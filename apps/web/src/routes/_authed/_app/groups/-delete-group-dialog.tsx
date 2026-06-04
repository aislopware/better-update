import { deleteGroup, groupsQueryKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";

import type { GroupItem } from "@better-update/api-client/react";

import { useApiMutation } from "../../../../lib/use-api-mutation";

export const DeleteGroupDialog = ({
  orgId,
  group,
  open,
  onOpenChange,
}: {
  orgId: string;
  group: GroupItem;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) => {
  const queryClient = useQueryClient();

  const deleteMutation = useApiMutation({
    mutationFn: async () => deleteGroup(group.id),
    onSuccess: async () => {
      toastManager.add({ title: "Group deleted", type: "success" });
      await queryClient.invalidateQueries({ queryKey: groupsQueryKey(orgId) });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Delete group?</DialogTitle>
          <DialogDescription>
            <strong className="font-semibold">{group.name}</strong> will be deleted. Its members
            lose any access granted through this group, and its policy attachments are removed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => {
              deleteMutation.mutate();
            }}
          >
            Delete group
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
