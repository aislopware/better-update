import { deleteChannel } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";

import type { Channel } from "@better-update/api";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
import { invalidateChannels } from "./-update-helpers";

export const DeleteChannelDialog = ({
  channel,
  orgId,
  projectId,
}: {
  channel: typeof Channel.Type;
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
      <Button variant="ghost" size="icon" className="size-8">
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="text-destructive size-4" />
      </Button>
    </ConfirmDeleteDialog>
  );
};
