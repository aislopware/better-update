import {
  completeBranchRollout,
  createBranchRollout,
  pauseChannel,
  resumeChannel,
  revertBranchRollout,
  updateBranchRollout,
  updateChannel,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  PauseIcon,
  PlayIcon,
  RocketIcon,
  SatelliteIcon,
  Undo2Icon,
} from "lucide-react";
import { useState } from "react";

import type { Channel, MissingRuntimeVersionBuild } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { ChannelBranchSelector } from "./-channel-branch-selector";
import { CompatibleBuildsSection, MissingMatchingBuilds } from "./-channel-compatibility";
import { parseRolloutState } from "./-channel-rollout-state";
import { DeleteChannelDialog } from "./-delete-channel-dialog";
import { RolloutSplitDiagram } from "./-rollout-split-diagram";
import { invalidateChannels as invalidateChannelsHelper } from "./-update-helpers";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "./-compatibility-join";

interface BranchRolloutControlsProps {
  readonly channel: Channel;
  readonly branches: readonly BranchItem[];
  readonly invalidateChannels: () => Promise<void>;
}

const ActiveRolloutControls = ({
  channel,
  branches,
  rolloutState,
  invalidateChannels,
}: BranchRolloutControlsProps & {
  readonly rolloutState: { targetBranchId: string; percentage: number };
}) => {
  const [rolloutDraft, setRolloutDraft] = useState<string | undefined>(undefined);
  const currentPercentage = String(rolloutState.percentage);
  const rolloutInput = rolloutDraft ?? currentPercentage;
  const rolloutTargetBranch = branches.find((branch) => branch.id === rolloutState.targetBranchId);
  const updateBranchRolloutMutation = useApiMutation({
    mutationFn: async (percentage: number) => updateBranchRollout(channel.id, { percentage }),
    onSuccess: async (_, percentage) => {
      setRolloutDraft(undefined);
      toastManager.add({ title: `Rollout updated to ${percentage}%`, type: "success" });
      await invalidateChannels();
    },
  });
  const completeBranchRolloutMutation = useApiMutation({
    mutationFn: async () => completeBranchRollout(channel.id),
    onSuccess: async () => {
      setRolloutDraft(undefined);
      toastManager.add({
        title: "Rollout completed — channel now serves the new branch",
        type: "success",
      });
      await invalidateChannels();
    },
  });
  const revertBranchRolloutMutation = useApiMutation({
    mutationFn: async () => revertBranchRollout(channel.id),
    onSuccess: async () => {
      setRolloutDraft(undefined);
      toastManager.add({
        title: "Rollout reverted — channel restored to original branch",
        type: "success",
      });
      await invalidateChannels();
    },
  });
  const isUpdatingRollout =
    updateBranchRolloutMutation.isPending ||
    completeBranchRolloutMutation.isPending ||
    revertBranchRolloutMutation.isPending;

  const handleUpdateRollout = () => {
    const percentage = Number.parseInt(rolloutInput, 10);
    if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
      toastManager.add({ title: "Rollout percentage must be between 1 and 100", type: "error" });
      return;
    }
    updateBranchRolloutMutation.mutate(percentage);
  };

  const handleCompleteRollout = () => {
    completeBranchRolloutMutation.mutate();
  };

  const handleRevertRollout = () => {
    revertBranchRolloutMutation.mutate();
  };

  const currentBranch = branches.find((branch) => branch.id === channel.branchId);
  const oldBranchName = currentBranch?.name ?? channel.branchId.slice(0, 8);
  const newBranchName = rolloutTargetBranch?.name ?? rolloutState.targetBranchId.slice(0, 8);

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm font-medium">
        Rolling out to {newBranchName} at {rolloutState.percentage}%
      </div>
      <RolloutSplitDiagram
        oldBranchName={oldBranchName}
        newBranchName={newBranchName}
        newBranchPercentage={rolloutState.percentage}
      />
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
          loading={updateBranchRolloutMutation.isPending}
          disabled={isUpdatingRollout || rolloutInput === currentPercentage}
          onClick={handleUpdateRollout}
        >
          Apply
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="outline"
                aria-label="Complete rollout"
                loading={isUpdatingRollout}
                onClick={handleCompleteRollout}
              />
            }
          >
            <CircleCheckIcon strokeWidth={2} />
          </TooltipTrigger>
          <TooltipPopup>Complete rollout — switch channel to new branch</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="outline"
                aria-label="Revert rollout"
                loading={isUpdatingRollout}
                onClick={handleRevertRollout}
              />
            }
          >
            <Undo2Icon strokeWidth={2} />
          </TooltipTrigger>
          <TooltipPopup>Revert rollout — keep original branch</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
};

const StartRolloutForm = ({
  channel,
  branches,
  onDone,
  invalidateChannels,
}: BranchRolloutControlsProps & { readonly onDone: () => void }) => {
  const createBranchRolloutMutation = useApiMutation({
    mutationFn: async (input: { newBranchId: string; percentage: number }) =>
      createBranchRollout(channel.id, input),
    onSuccess: async (_, input) => {
      toastManager.add({
        title: `Branch rollout started at ${input.percentage}%`,
        type: "success",
      });
      await invalidateChannels();
      onDone();
    },
  });

  const form = useForm({
    defaultValues: { branchId: "", percentage: "" },
    onSubmit: async ({ value }) => {
      const percentage = Number.parseInt(value.percentage, 10);
      if (!value.branchId) {
        toastManager.add({ title: "Select a target branch", type: "error" });
        return;
      }
      if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
        toastManager.add({ title: "Rollout percentage must be between 1 and 100", type: "error" });
        return;
      }
      await safeSubmit(
        createBranchRolloutMutation.mutateAsync({ newBranchId: value.branchId, percentage }),
      );
    },
  });

  const targetBranches = branches.filter((branch) => branch.id !== channel.branchId);
  const targetBranchLabels: Record<string, string> = Object.fromEntries(
    targetBranches.map((branch) => [branch.id, branch.name]),
  );

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <form.Field name="branchId">
        {(field) => (
          <Select
            items={targetBranchLabels}
            value={field.state.value}
            onValueChange={(value) => {
              if (value === null) {
                return;
              }
              field.handleChange(value);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Target branch" />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {targetBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        )}
      </form.Field>
      <form.Field name="percentage">
        {(field) => (
          <Input
            type="number"
            min={1}
            max={100}
            placeholder="%"
            value={field.state.value}
            onChange={(event) => {
              field.handleChange(event.target.value);
            }}
            className="w-20"
            disabled={createBranchRolloutMutation.isPending}
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state) =>
          [state.values.branchId, state.values.percentage, state.isSubmitting] as const
        }
      >
        {([branchId, percentage, isSubmitting]) => (
          <Button type="submit" disabled={!branchId || !percentage} loading={isSubmitting}>
            Start
          </Button>
        )}
      </form.Subscribe>
      <Button
        type="button"
        variant="ghost"
        disabled={createBranchRolloutMutation.isPending}
        onClick={onDone}
      >
        Cancel
      </Button>
    </form>
  );
};

const StartRolloutControls = (props: BranchRolloutControlsProps) => {
  const [isStartingRollout, setIsStartingRollout] = useState(false);
  const targetBranchCount = props.branches.filter(
    (branch) => branch.id !== props.channel.branchId,
  ).length;
  const noTargetsReason =
    targetBranchCount === 0 ? "Create another branch first to enable rollouts" : undefined;

  if (!isStartingRollout) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex w-fit">
              <Button
                variant="outline"
                disabled={noTargetsReason !== undefined}
                onClick={() => {
                  setIsStartingRollout(true);
                }}
              >
                <RocketIcon strokeWidth={2} data-icon="inline-start" />
                Start Rollout
              </Button>
            </span>
          }
        />
        <TooltipPopup>{noTargetsReason ?? "Start a branch rollout"}</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <StartRolloutForm
      channel={props.channel}
      branches={props.branches}
      invalidateChannels={props.invalidateChannels}
      onDone={() => {
        setIsStartingRollout(false);
      }}
    />
  );
};

interface ChannelCardProps {
  readonly channel: Channel;
  readonly orgId: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly branches: readonly BranchItem[];
  readonly compatibleBuilds: readonly {
    readonly build: BuildWithSyntheticChannels;
    readonly status: SyntheticBuildChannel;
  }[];
  readonly missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
  readonly showDetailsLink?: boolean;
}

export const ChannelCard = ({
  channel,
  orgId,
  projectId,
  projectSlug,
  branches,
  compatibleBuilds,
  missingRuntimeVersions,
  showDetailsLink = true,
}: ChannelCardProps) => {
  const queryClient = useQueryClient();
  const linkedBranch = branches.find((branch) => branch.id === channel.branchId);
  const branchLabels: Record<string, string> = Object.fromEntries(
    branches.map((branch) => [branch.id, branch.name]),
  );

  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;

  const invalidateChannels = async (): Promise<void> =>
    invalidateChannelsHelper(queryClient, orgId, projectId);
  const updateChannelMutation = useApiMutation({
    mutationFn: async (branchId: string) => updateChannel(channel.id, { branchId }),
    onSuccess: async () => {
      toastManager.add({ title: "Channel relinked", type: "success" });
      await invalidateChannels();
    },
  });
  const togglePauseMutation = useApiMutation({
    mutationFn: async () =>
      channel.isPaused ? resumeChannel(channel.id) : pauseChannel(channel.id),
    onSuccess: async () => {
      toastManager.add({
        title: channel.isPaused ? "Channel resumed" : "Channel paused",
        type: "success",
      });
      await invalidateChannels();
    },
  });
  const isToggling = togglePauseMutation.isPending;

  const handleRelink = (branchId: string) => {
    updateChannelMutation.mutate(branchId);
  };

  const handleTogglePause = () => {
    togglePauseMutation.mutate();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <SatelliteIcon strokeWidth={2} className="text-muted-foreground size-5" />
            <CardTitle className="text-base">{channel.name}</CardTitle>
            {showDetailsLink ? (
              <Link
                to="/projects/$projectSlug/channels/$channelId"
                params={{ projectSlug, channelId: channel.id }}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                View details
              </Link>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {channel.isPaused && <Badge variant="warning">Paused</Badge>}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={channel.isPaused ? "Resume channel" : "Pause channel"}
                    loading={isToggling}
                    onClick={handleTogglePause}
                  />
                }
              >
                {channel.isPaused ? <PlayIcon strokeWidth={2} /> : <PauseIcon strokeWidth={2} />}
              </TooltipTrigger>
              <TooltipPopup>{channel.isPaused ? "Resume channel" : "Pause channel"}</TooltipPopup>
            </Tooltip>
            <DeleteChannelDialog channel={channel} orgId={orgId} projectId={projectId} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChannelBranchSelector
          branches={branches}
          branchLabels={branchLabels}
          currentBranchId={channel.branchId}
          currentBranchName={linkedBranch?.name ?? channel.branchId}
          isRollingOut={rolloutState !== null}
          onRelink={handleRelink}
        />

        {rolloutState ? (
          <ActiveRolloutControls
            channel={channel}
            branches={branches}
            rolloutState={rolloutState}
            invalidateChannels={invalidateChannels}
          />
        ) : (
          <StartRolloutControls
            channel={channel}
            branches={branches}
            invalidateChannels={invalidateChannels}
          />
        )}
        <CompatibleBuildsSection compatibleBuilds={compatibleBuilds} />
        <MissingMatchingBuilds missingRuntimeVersions={missingRuntimeVersions} />
      </CardContent>
    </Card>
  );
};
