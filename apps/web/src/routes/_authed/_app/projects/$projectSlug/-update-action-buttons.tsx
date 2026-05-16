import { deleteUpdateGroup } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { RocketIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import type { Channel, Update } from "@better-update/api";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { PromoteUpdateDialog } from "./-promote-update-dialog";
import { RollbackToEmbeddedDialog } from "./-rollback-to-embedded-dialog";
import { invalidateUpdates } from "./-update-helpers";

interface UpdateActionButtonsProps {
  readonly update: typeof Update.Type;
  readonly channels: readonly (typeof Channel.Type)[];
  readonly branchName: string | undefined;
  readonly slug: string;
  readonly orgId: string;
  readonly projectId: string;
}

export const UpdateActionButtons = ({
  update,
  channels,
  branchName,
  slug,
  orgId,
  projectId,
}: UpdateActionButtonsProps) => {
  const queryClient = useQueryClient();
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const eligibleChannels = channels.filter((channel) => channel.branchId !== update.branchId);
  const canCreateFollowupUpdate = !update.isRollback && !update.signature;
  const canRollbackToEmbedded = canCreateFollowupUpdate && branchName !== undefined;
  const canPromote = canCreateFollowupUpdate && eligibleChannels.length > 0;

  const deleteUpdateGroupMutation = useApiMutation({
    mutationFn: async () => deleteUpdateGroup(update.groupId),
    onSuccess: async () => {
      toastManager.add({ title: "Update group deleted", type: "success" });
      await invalidateUpdates(queryClient, orgId, projectId);
    },
  });

  return (
    <div className="flex items-center gap-1">
      {canRollbackToEmbedded && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Rollback to embedded"
                onClick={() => {
                  setRollbackOpen(true);
                }}
              />
            }
          >
            <Undo2Icon strokeWidth={2} />
          </TooltipTrigger>
          <TooltipPopup>Rollback to embedded</TooltipPopup>
        </Tooltip>
      )}
      {canPromote && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Promote to another channel"
                onClick={() => {
                  setPromoteOpen(true);
                }}
              />
            }
          >
            <RocketIcon strokeWidth={2} />
          </TooltipTrigger>
          <TooltipPopup>Promote to another channel</TooltipPopup>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete update group"
              loading={deleteUpdateGroupMutation.isPending}
              onClick={() => {
                deleteUpdateGroupMutation.mutate();
              }}
            />
          }
        >
          <Trash2Icon strokeWidth={2} />
        </TooltipTrigger>
        <TooltipPopup>Delete update group</TooltipPopup>
      </Tooltip>
      {canRollbackToEmbedded && (
        <RollbackToEmbeddedDialog
          update={update}
          branchName={branchName}
          slug={slug}
          orgId={orgId}
          projectId={projectId}
          open={rollbackOpen}
          onOpenChange={setRollbackOpen}
        />
      )}
      {canPromote && (
        <PromoteUpdateDialog
          update={update}
          channels={eligibleChannels}
          orgId={orgId}
          projectId={projectId}
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
        />
      )}
    </div>
  );
};
