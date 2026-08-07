import { deleteChannel } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";

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
      <Button
        variant="ghost"
        shape="square"
        className="text-kumo-subtle/70 hover:text-kumo-danger size-8"
        aria-label="Delete channel"
      >
        <TrashIcon weight="bold" className="size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
