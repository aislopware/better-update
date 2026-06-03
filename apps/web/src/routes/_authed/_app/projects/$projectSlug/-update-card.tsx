import {
  completeUpdateRollout,
  editUpdateRollout,
  revertUpdateRollout,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleCheckIcon, FingerprintIcon, Undo2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import type { Channel, Update } from "@better-update/api";

import { EnvironmentBadge, PlatformBadge } from "../../../../../components/attribute-badges";
import { formatDateTime } from "../../../../../lib/format-date";
import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { UpdateActionButtons } from "./-update-action-buttons";
import { invalidateUpdates, readUpdateEnvironment } from "./-update-helpers";

interface UpdateCardProps {
  readonly update: Update;
  readonly channels: readonly Channel[];
  readonly branchName: string | undefined;
  readonly slug: string;
  readonly orgId: string;
  readonly projectId: string;
}

export const UpdateCard = ({
  update,
  channels,
  branchName,
  slug,
  orgId,
  projectId,
}: UpdateCardProps) => {
  const queryClient = useQueryClient();
  const [rolloutDraft, setRolloutDraft] = useState<string | undefined>(undefined);

  const currentRollout = String(update.rolloutPercentage);
  const rolloutInput = rolloutDraft ?? currentRollout;

  const environment = useMemo(() => readUpdateEnvironment(update.extraJson), [update.extraJson]);

  const invalidate = async () => invalidateUpdates(queryClient, orgId, projectId);
  const editUpdateRolloutMutation = useApiMutation({
    mutationFn: async (percentage: number) => editUpdateRollout(update.id, { percentage }),
    onSuccess: async (_, percentage) => {
      setRolloutDraft(undefined);
      toastManager.add({ title: `Rollout updated to ${percentage}%`, type: "success" });
      await invalidate();
    },
  });
  const completeUpdateRolloutMutation = useApiMutation({
    mutationFn: async () => completeUpdateRollout(update.id),
    onSuccess: async () => {
      setRolloutDraft(undefined);
      toastManager.add({
        title: "Rollout completed — update available to all devices",
        type: "success",
      });
      await invalidate();
    },
  });
  const revertUpdateRolloutMutation = useApiMutation({
    mutationFn: async () => revertUpdateRollout(update.id),
    onSuccess: async () => {
      setRolloutDraft(undefined);
      toastManager.add({ title: "Rollout reverted", type: "success" });
      await invalidate();
    },
  });
  const isUpdatingRollout =
    editUpdateRolloutMutation.isPending ||
    completeUpdateRolloutMutation.isPending ||
    revertUpdateRolloutMutation.isPending;

  const handleEditRollout = () => {
    const percentage = Number.parseInt(rolloutInput, 10);
    if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
      toastManager.add({ title: "Rollout percentage must be between 1 and 100", type: "error" });
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
            <PlatformBadge platform={update.platform} />
            {typeof environment === "string" && <EnvironmentBadge environment={environment} />}
            {update.isRollback && <Badge variant="destructive">Rollback</Badge>}
          </div>
          <UpdateActionButtons
            update={update}
            channels={channels}
            branchName={branchName}
            slug={slug}
            orgId={orgId}
            projectId={projectId}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>v{update.runtimeVersion}</span>
          <span>{formatDateTime(update.createdAt)}</span>
          <span className="font-mono text-xs">{update.groupId.slice(0, 8)}</span>
          {update.fingerprintHash !== null && (
            <Link
              to="/projects/$projectSlug/fingerprints/$hash"
              params={{ projectSlug: slug, hash: update.fingerprintHash }}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-xs transition-colors"
            >
              <FingerprintIcon strokeWidth={2} className="size-3" />
              {update.fingerprintHash.slice(0, 12)}
            </Link>
          )}
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
              setRolloutDraft(event.target.value);
            }}
            className="w-20"
            disabled={isUpdatingRollout}
          />
          <span className="text-muted-foreground text-sm">%</span>
          <Button
            variant="outline"
            loading={editUpdateRolloutMutation.isPending}
            disabled={isUpdatingRollout || rolloutInput === currentRollout}
            onClick={handleEditRollout}
          >
            Apply
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Complete rollout (100%)"
                    loading={completeUpdateRolloutMutation.isPending}
                    disabled={isUpdatingRollout || update.rolloutPercentage === 100}
                    onClick={handleComplete}
                  >
                    <CircleCheckIcon strokeWidth={2} />
                  </Button>
                </span>
              }
            />
            <TooltipPopup>
              {update.rolloutPercentage === 100
                ? "Already at 100% — rollout complete"
                : "Complete rollout (100%)"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Revert rollout (0%)"
                    loading={revertUpdateRolloutMutation.isPending}
                    disabled={isUpdatingRollout || update.rolloutPercentage === 0}
                    onClick={handleRevert}
                  >
                    <Undo2Icon strokeWidth={2} />
                  </Button>
                </span>
              }
            />
            <TooltipPopup>
              {update.rolloutPercentage === 0
                ? "Already at 0% — nothing to revert"
                : "Revert rollout (0%)"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
};
