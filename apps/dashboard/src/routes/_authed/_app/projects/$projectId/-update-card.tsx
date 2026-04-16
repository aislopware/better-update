import { safeJsonParse } from "@better-update/api";
import {
  buildCompatibilityMatrixQueryKey,
  completeUpdateRollout,
  deleteUpdateGroup,
  editUpdateRollout,
  revertUpdateRollout,
  updatesQueryKey,
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
import { Effect } from "effect";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { Channel, Update } from "@better-update/api";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { PromoteUpdateDialog } from "./-promote-update-dialog";
import { RollbackToEmbeddedDialog } from "./-rollback-to-embedded-dialog";

interface UpdateCardProps {
  readonly update: typeof Update.Type;
  readonly channels: readonly (typeof Channel.Type)[];
  readonly branchName: string | undefined;
  readonly scopeKey: string;
  readonly orgId: string;
  readonly projectId: string;
}

export const UpdateCard = ({
  update,
  channels,
  branchName,
  scopeKey,
  orgId,
  projectId,
}: UpdateCardProps) => {
  const queryClient = useQueryClient();
  const [rolloutInput, setRolloutInput] = useState(String(update.rolloutPercentage));
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  const environment = useMemo(() => {
    if (!update.extraJson) {
      return undefined;
    }
    const parsed = safeJsonParse(update.extraJson);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- extraJson is always a JSON object written by our CLI
    const value = (parsed as Record<string, unknown>)["environment"];
    return typeof value === "string" ? value : undefined;
  }, [update.extraJson]);
  const eligibleChannels = channels.filter((channel) => channel.branchId !== update.branchId);
  const canCreateFollowupUpdate = !update.isRollback && !update.signature;
  const canRollbackToEmbedded = canCreateFollowupUpdate && branchName !== undefined;
  const canPromote = canCreateFollowupUpdate && eligibleChannels.length > 0;

  const invalidateUpdates = async () =>
    Effect.runPromise(
      Effect.asVoid(
        Effect.all(
          [
            Effect.promise(async () =>
              queryClient.invalidateQueries({
                queryKey: updatesQueryKey(orgId, projectId),
              }),
            ),
            Effect.promise(async () =>
              queryClient.invalidateQueries({
                queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
              }),
            ),
          ],
          { concurrency: "unbounded" },
        ),
      ),
    );
  const deleteUpdateGroupMutation = useApiMutation({
    mutationFn: async () => deleteUpdateGroup(update.groupId),
    onSuccess: async () => {
      toast.success("Update group deleted");
      await invalidateUpdates();
    },
  });
  const editUpdateRolloutMutation = useApiMutation({
    mutationFn: async (percentage: number) => editUpdateRollout(update.id, { percentage }),
    onSuccess: async (_, percentage) => {
      toast.success(`Rollout updated to ${percentage}%`);
      await invalidateUpdates();
    },
  });
  const completeUpdateRolloutMutation = useApiMutation({
    mutationFn: async () => completeUpdateRollout(update.id),
    onSuccess: async () => {
      toast.success("Rollout completed — update available to all devices");
      await invalidateUpdates();
    },
  });
  const revertUpdateRolloutMutation = useApiMutation({
    mutationFn: async () => revertUpdateRollout(update.id),
    onSuccess: async () => {
      toast.success("Rollout reverted");
      await invalidateUpdates();
    },
  });
  const isDeleting = deleteUpdateGroupMutation.isPending;
  const isUpdatingRollout =
    editUpdateRolloutMutation.isPending ||
    completeUpdateRolloutMutation.isPending ||
    revertUpdateRolloutMutation.isPending;

  const handleDelete = () => {
    deleteUpdateGroupMutation.mutate();
  };

  const handleEditRollout = () => {
    const percentage = Number.parseInt(rolloutInput, 10);
    if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
      toast.error("Rollout percentage must be between 1 and 100");
      return;
    }
    editUpdateRolloutMutation.mutate(percentage);
  };

  const handleComplete = () => {
    completeUpdateRolloutMutation.mutate();
  };

  const handleRevert = () => {
    revertUpdateRolloutMutation.mutate();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">{update.message}</CardTitle>
            <Badge variant="outline">{update.platform}</Badge>
            {typeof environment === "string" && <Badge variant="secondary">{environment}</Badge>}
            {update.isRollback && <Badge variant="destructive">Rollback</Badge>}
          </div>
          <div className="flex items-center gap-1">
            {canRollbackToEmbedded && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                title="Rollback to embedded"
                onClick={() => {
                  setRollbackOpen(true);
                }}
              >
                <HugeiconsIcon icon={UndoIcon} strokeWidth={2} className="size-4" />
              </Button>
            )}
            {canPromote && (
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
      {canRollbackToEmbedded && (
        <RollbackToEmbeddedDialog
          update={update}
          branchName={branchName}
          scopeKey={scopeKey}
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
    </Card>
  );
};
