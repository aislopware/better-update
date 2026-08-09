import { deleteChannel } from "@better-update/api-client/react";
import { useQueryClient } from "@tanstack/react-query";

import type { Channel } from "@better-update/api";

import { ConfirmDeleteDialog, deleteIconTrigger } from "./-confirm-delete-dialog";
import { invalidateChannels } from "./-update-helpers";

/**
 * Delete confirmation for one channel. On the detail page it carries its own
 * trigger button; in a list the row's ⋮ menu opens it, so `open`/`onOpenChange`
 * let the page own the state — a menu unmounts on select and would take an
 * uncontrolled dialog down with it.
 */
export const DeleteChannelDialog = ({
  channel,
  orgId,
  projectId,
  open,
  onOpenChange,
}: {
  channel: Channel;
  orgId: string;
  projectId: string;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}) => {
  const queryClient = useQueryClient();

  return (
    <ConfirmDeleteDialog
      name={channel.name}
      title={`Delete ${channel.name}?`}
      description="This action cannot be undone. The channel will be permanently removed and clients will no longer receive updates through it."
      onConfirm={async () => deleteChannel(channel.id)}
      successMessage="Channel deleted"
      onSuccess={async () => {
        await invalidateChannels(queryClient, orgId, projectId);
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      {open === undefined ? deleteIconTrigger("Delete channel") : undefined}
    </ConfirmDeleteDialog>
  );
};
