import { getApiError } from "@better-update/api-client";
import {
  completeUpdateRollout,
  deleteUpdateGroup,
  editUpdateRollout,
  revertUpdateRollout,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { Input } from "@better-update/ui/components/ui/input";
import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  Rocket01Icon,
  UndoIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Channel, Update } from "@better-update/api";

import { PromoteUpdateDialog } from "./-promote-update-dialog";

interface UpdateCardProps {
  readonly update: typeof Update.Type;
  readonly channels: readonly (typeof Channel.Type)[];
  readonly orgId: string;
  readonly projectId: string;
}

export const UpdateCard = ({ update, channels, orgId, projectId }: UpdateCardProps) => {
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [rolloutInput, setRolloutInput] = useState(String(update.rolloutPercentage));
  const [isUpdatingRollout, setIsUpdatingRollout] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);

  const eligibleChannels = channels.filter((channel) => channel.branchId !== update.branchId);

  const invalidateUpdates = async () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "updates"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
      }),
    ]);

  const handleDelete = async () => {
    setIsDeleting(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await deleteUpdateGroup(update.groupId);
    } catch (error) {
      toast.error(getApiError(error));
      setIsDeleting(false);
      return;
    }
    toast.success("Update group deleted");
    await invalidateUpdates();
    setIsDeleting(false);
  };

  const handleEditRollout = async () => {
    const percentage = Number.parseInt(rolloutInput, 10);
    if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
      toast.error("Rollout percentage must be between 1 and 100");
      return;
    }
    setIsUpdatingRollout(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await editUpdateRollout(update.id, { percentage });
    } catch (error) {
      toast.error(getApiError(error));
      setIsUpdatingRollout(false);
      return;
    }
    toast.success(`Rollout updated to ${percentage}%`);
    await invalidateUpdates();
    setIsUpdatingRollout(false);
  };

  const handleComplete = async () => {
    setIsUpdatingRollout(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await completeUpdateRollout(update.id);
    } catch (error) {
      toast.error(getApiError(error));
      setIsUpdatingRollout(false);
      return;
    }
    toast.success("Rollout completed — update available to all devices");
    await invalidateUpdates();
    setIsUpdatingRollout(false);
  };

  const handleRevert = async () => {
    setIsUpdatingRollout(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await revertUpdateRollout(update.id);
    } catch (error) {
      toast.error(getApiError(error));
      setIsUpdatingRollout(false);
      return;
    }
    toast.success("Rollout reverted");
    await invalidateUpdates();
    setIsUpdatingRollout(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{update.message}</CardTitle>
            <Badge variant="outline">{update.platform}</Badge>
            {update.isRollback && <Badge variant="destructive">Rollback</Badge>}
          </div>
          <div className="flex items-center gap-1">
            {eligibleChannels.length > 0 && !update.isRollback && !update.signature && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="Promote to another channel"
                onClick={() => {
                  setPromoteOpen(true);
                }}
              >
                <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              title="Delete update group"
              disabled={isDeleting}
              onClick={handleDelete}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>v{update.runtimeVersion}</span>
          <span>{new Date(update.createdAt).toLocaleString()}</span>
          <span className="font-mono text-xs">{update.groupId.slice(0, 8)}</span>
        </div>

        {/* Rollout controls */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Rollout:</span>
          <Input
            type="number"
            min={1}
            max={100}
            value={rolloutInput}
            onChange={(event) => {
              setRolloutInput(event.target.value);
            }}
            className="w-20"
            disabled={isUpdatingRollout}
          />
          <span className="text-muted-foreground text-sm">%</span>
          <Button
            size="sm"
            variant="outline"
            disabled={isUpdatingRollout || rolloutInput === String(update.rolloutPercentage)}
            onClick={handleEditRollout}
          >
            Apply
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            title="Complete rollout (100%)"
            disabled={isUpdatingRollout || update.rolloutPercentage === 100}
            onClick={handleComplete}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="size-8"
            title="Revert rollout (0%)"
            disabled={isUpdatingRollout || update.rolloutPercentage === 0}
            onClick={handleRevert}
          >
            <HugeiconsIcon icon={UndoIcon} strokeWidth={2} className="size-4" />
          </Button>
        </div>
      </CardContent>
      {eligibleChannels.length > 0 && (
        <PromoteUpdateDialog
          update={update}
          channels={eligibleChannels}
          orgId={orgId}
          projectId={projectId}
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
        />
      )}
    </Card>
  );
};
