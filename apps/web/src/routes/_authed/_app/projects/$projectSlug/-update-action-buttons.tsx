import { deleteUpdateGroup } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, RocketIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import type { Channel, Update } from "@better-update/api";
import type { ReactNode } from "react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { PreviewUpdateDialog } from "./-preview-update-dialog";
import { PromoteUpdateDialog } from "./-promote-update-dialog";
import { RepublishUpdateDialog } from "./-republish-update-dialog";
import { RollbackToEmbeddedDialog } from "./-rollback-to-embedded-dialog";
import { invalidateUpdates } from "./-update-helpers";

interface UpdateActionButtonsProps {
  readonly update: Update;
  readonly channels: readonly Channel[];
  readonly branchName: string | undefined;
  readonly slug: string;
  readonly orgId: string;
  readonly projectId: string;
}

const computeFollowupBlockReason = (update: Update): string | undefined => {
  if (update.isRollback) {
    return "Cannot create a follow-up update from a rollback";
  }
  if (update.signature !== null) {
    return "Cannot create a follow-up update from a signed update";
  }
  return undefined;
};

interface ActionTooltipButtonProps {
  readonly ariaLabel: string;
  readonly enabledTooltip: string;
  readonly disabledReason: string | undefined;
  readonly icon: ReactNode;
  readonly loading?: boolean;
  readonly onClick: () => void;
}

const ActionTooltipButton = ({
  ariaLabel,
  enabledTooltip,
  disabledReason,
  icon,
  loading,
  onClick,
}: ActionTooltipButtonProps) => {
  const isDisabled = disabledReason !== undefined;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="icon"
              aria-label={ariaLabel}
              disabled={isDisabled}
              loading={loading ?? false}
              onClick={onClick}
            >
              {icon}
            </Button>
          </span>
        }
      />
      <TooltipPopup>{isDisabled ? disabledReason : enabledTooltip}</TooltipPopup>
    </Tooltip>
  );
};

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
  const [republishOpen, setRepublishOpen] = useState(false);

  const eligibleChannels = channels.filter((channel) => channel.branchId !== update.branchId);
  const followupBlockReason = computeFollowupBlockReason(update);
  const branchMissingReason = branchName === undefined ? "Branch info unavailable" : undefined;
  const rollbackDisabledReason = followupBlockReason ?? branchMissingReason;
  const republishDisabledReason = followupBlockReason ?? branchMissingReason;
  const promoteDisabledReason =
    followupBlockReason ??
    (eligibleChannels.length === 0
      ? "No other channels available to promote this update to"
      : undefined);

  const deleteUpdateGroupMutation = useApiMutation({
    mutationFn: async () => deleteUpdateGroup(update.groupId),
    onSuccess: async () => {
      toastManager.add({ title: "Update group deleted", type: "success" });
      await invalidateUpdates(queryClient, orgId, projectId);
    },
  });

  return (
    <div className="flex items-center gap-1">
      <PreviewUpdateDialog
        update={update}
        branchName={branchName}
        channels={channels}
        projectSlug={slug}
        orgId={orgId}
        projectId={projectId}
      />
      <ActionTooltipButton
        ariaLabel="Rollback to embedded"
        enabledTooltip="Rollback to embedded"
        disabledReason={rollbackDisabledReason}
        icon={<Undo2Icon strokeWidth={2} />}
        onClick={() => {
          setRollbackOpen(true);
        }}
      />
      <ActionTooltipButton
        ariaLabel="Republish update"
        enabledTooltip="Republish on same branch"
        disabledReason={republishDisabledReason}
        icon={<RefreshCwIcon strokeWidth={2} />}
        onClick={() => {
          setRepublishOpen(true);
        }}
      />
      <ActionTooltipButton
        ariaLabel="Promote to another channel"
        enabledTooltip="Promote to another channel"
        disabledReason={promoteDisabledReason}
        icon={<RocketIcon strokeWidth={2} />}
        onClick={() => {
          setPromoteOpen(true);
        }}
      />
      <ActionTooltipButton
        ariaLabel="Delete update group"
        enabledTooltip="Delete update group"
        disabledReason={undefined}
        icon={<Trash2Icon strokeWidth={2} />}
        loading={deleteUpdateGroupMutation.isPending}
        onClick={() => {
          deleteUpdateGroupMutation.mutate();
        }}
      />
      {rollbackDisabledReason === undefined && branchName !== undefined && (
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
      {promoteDisabledReason === undefined && (
        <PromoteUpdateDialog
          update={update}
          channels={eligibleChannels}
          orgId={orgId}
          projectId={projectId}
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
        />
      )}
      {republishDisabledReason === undefined && branchName !== undefined && (
        <RepublishUpdateDialog
          update={update}
          branchName={branchName}
          orgId={orgId}
          projectId={projectId}
          open={republishOpen}
          onOpenChange={setRepublishOpen}
        />
      )}
    </div>
  );
};
