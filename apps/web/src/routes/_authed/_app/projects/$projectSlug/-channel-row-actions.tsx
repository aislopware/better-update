import { pauseChannel, resumeChannel } from "@better-update/api-client/react";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { toast } from "@better-update/ui/components/toast";
import { PauseIcon, PlayIcon, TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { Channel } from "@better-update/api";

import { RowActionsMenu } from "../../../../../lib/data-table";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { DeleteChannelDialog } from "./-delete-channel-dialog";
import { invalidateChannels } from "./-update-helpers";

/**
 * Row actions for the channels list, in the same ⋮ menu every other list uses.
 * Bare icon buttons used to sit in the row instead, which left built-in
 * channels — the ones that cannot be deleted — with a lone pause button parked
 * under the neighbouring rows' delete button. A menu has one anchor whatever it
 * holds, so the column lines up whether or not a row can be deleted.
 *
 * Delete open-state is lifted out of the menu, per the Menu→Dialog convention:
 * picking an item unmounts the menu, and an uncontrolled dialog would go with it.
 */
export const ChannelRowActions = ({
  channel,
  orgId,
  projectId,
}: {
  channel: Channel;
  orgId: string;
  projectId: string;
}) => {
  const queryClient = useQueryClient();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const togglePauseMutation = useApiMutation({
    mutationFn: async () =>
      channel.isPaused ? resumeChannel(channel.id) : pauseChannel(channel.id),
    onSuccess: async () => {
      toast.success(channel.isPaused ? "Channel resumed" : "Channel paused");
      await invalidateChannels(queryClient, orgId, projectId);
    },
  });

  return (
    <>
      <RowActionsMenu label="Channel actions" isPending={togglePauseMutation.isPending}>
        <DropdownMenu.Item
          icon={channel.isPaused ? PlayIcon : PauseIcon}
          onClick={() => {
            togglePauseMutation.mutate();
          }}
        >
          {channel.isPaused ? "Resume channel" : "Pause channel"}
        </DropdownMenu.Item>
        {/* Built-in channels are part of the project's shape, not a release
            track someone added, so they pause but never delete. */}
        {channel.isBuiltin ? null : (
          <DropdownMenu.Item
            variant="danger"
            icon={TrashIcon}
            onClick={() => {
              setIsDeleteOpen(true);
            }}
          >
            Delete channel
          </DropdownMenu.Item>
        )}
      </RowActionsMenu>
      {channel.isBuiltin ? null : (
        <DeleteChannelDialog
          channel={channel}
          orgId={orgId}
          projectId={projectId}
          open={isDeleteOpen}
          onOpenChange={setIsDeleteOpen}
        />
      )}
    </>
  );
};
