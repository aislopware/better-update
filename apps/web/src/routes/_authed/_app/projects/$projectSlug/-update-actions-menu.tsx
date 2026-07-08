import { deleteUpdateGroup } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  EllipsisVerticalIcon,
  EyeIcon,
  RefreshCwIcon,
  RocketIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useState } from "react";

import type { Channel, Update } from "@better-update/api";

import { ConfirmDeleteDialog } from "./-confirm-delete-dialog";
import { PreviewUpdateDialog } from "./-preview-update-dialog";
import { PromoteUpdateDialog } from "./-promote-update-dialog";
import { RepublishUpdateDialog } from "./-republish-update-dialog";
import { RollbackToEmbeddedDialog } from "./-rollback-to-embedded-dialog";
import { invalidateUpdates } from "./-update-helpers";

interface UpdateActionsMenuProps {
  readonly update: Update;
  readonly channels: readonly Channel[];
  readonly branchName: string | undefined;
  readonly slug: string;
  readonly orgId: string;
  readonly projectId: string;
  /** Detail pages navigate away after the group is deleted; lists just refetch. */
  readonly onDeleted?: () => Promise<void>;
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

/**
 * Row actions for the updates table, collapsed into a single ⋮ menu. Dialog
 * state lives here so menu items stay plain onClick triggers (menu → dialog
 * pattern).
 */
export const UpdateActionsMenu = ({
  update,
  channels,
  branchName,
  slug,
  orgId,
  projectId,
  onDeleted,
}: UpdateActionsMenuProps) => {
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [republishOpen, setRepublishOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground/70 hover:text-foreground"
              aria-label="Update actions"
            />
          }
        >
          <EllipsisVerticalIcon strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem
            onClick={() => {
              setPreviewOpen(true);
            }}
          >
            <EyeIcon strokeWidth={2} />
            <span>Preview on device</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={promoteDisabledReason !== undefined}
            onClick={() => {
              setPromoteOpen(true);
            }}
          >
            <RocketIcon strokeWidth={2} />
            <span>Promote to channel</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={republishDisabledReason !== undefined}
            onClick={() => {
              setRepublishOpen(true);
            }}
          >
            <RefreshCwIcon strokeWidth={2} />
            <span>Republish on branch</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={rollbackDisabledReason !== undefined}
            onClick={() => {
              setRollbackOpen(true);
            }}
          >
            <Undo2Icon strokeWidth={2} />
            <span>Rollback to embedded</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            <Trash2Icon strokeWidth={2} />
            <span>Delete update group</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PreviewUpdateDialog
        update={update}
        branchName={branchName}
        channels={channels}
        projectSlug={slug}
        orgId={orgId}
        projectId={projectId}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
      <ConfirmDeleteDialog
        name={update.message || update.groupId.slice(0, 8)}
        title="Delete update group?"
        description="This action cannot be undone. All platform variants in this update group will be permanently deleted."
        onConfirm={async () => deleteUpdateGroup(update.groupId)}
        successMessage="Update group deleted"
        onSuccess={async () => {
          await onDeleted?.();
          await invalidateUpdates(queryClient, orgId, projectId);
        }}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
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
    </>
  );
};
