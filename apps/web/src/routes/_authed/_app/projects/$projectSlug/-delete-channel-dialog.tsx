import { deleteChannel } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";

import type { Channel } from "@better-update/api";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
import { invalidateChannels } from "./-update-helpers";

export const DeleteChannelDialog = ({
  channel,
  orgId,
  projectId,
}: {
  channel: Channel;
  orgId: string;
  projectId: string;
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
    >
      <Button variant="ghost" size="icon" className="size-8" aria-label="Delete channel">
        <Trash2Icon strokeWidth={2} className="text-destructive size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
