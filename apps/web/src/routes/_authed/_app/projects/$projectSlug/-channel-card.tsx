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
import { useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  GitBranchIcon,
  PauseIcon,
  PlayIcon,
  RocketIcon,
  SatelliteIcon,
  Undo2Icon,
} from "lucide-react";
import { useState } from "react";

import type { Channel, MissingRuntimeVersionBuild } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { CompatibleBuildsSection, MissingMatchingBuilds } from "./-channel-compatibility";
import { parseRolloutState } from "./-channel-rollout-state";
import { DeleteChannelDialog } from "./-delete-channel-dialog";
import { invalidateChannels as invalidateChannelsHelper } from "./-update-helpers";

import type { BuildWithSyntheticChannels, SyntheticBuildChannel } from "./-compatibility-join";

interface BranchRolloutControlsProps {
  readonly channel: typeof Channel.Type;
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
  const [rolloutInput, setRolloutInput] = useState<string | null>(null);
  const rolloutTargetBranch = branches.find((branch) => branch.id === rolloutState.targetBranchId);
  const updateBranchRolloutMutation = useApiMutation({
    mutationFn: async (percentage: number) => updateBranchRollout(channel.id, { percentage }),
    onSuccess: async (_, percentage) => {
      toastManager.add({ title: `Rollout updated to ${percentage}%`, type: "success" });
      await invalidateChannels();
    },
  });
  const completeBranchRolloutMutation = useApiMutation({
    mutationFn: async () => completeBranchRollout(channel.id),
    onSuccess: async () => {
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
    const percentage = Number.parseInt(rolloutInput ?? String(rolloutState.percentage), 10);
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

  return (
    <div className="flex flex-col gap-2">
      <Badge variant="secondary">
        Rolling out to {rolloutTargetBranch?.name ?? rolloutState.targetBranchId} at{" "}
        {rolloutState.percentage}%
      </Badge>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Rollout:</span>
        <Input
          type="number"
          min={1}
          max={100}
          value={rolloutInput ?? String(rolloutState.percentage)}
          onChange={(event) => {
            setRolloutInput(event.target.value);
          }}
          className="w-20"
          disabled={isUpdatingRollout}
        />
        <span className="text-muted-foreground text-sm">%</span>
        <Button
          variant="outline"
          disabled={
            isUpdatingRollout ||
            rolloutInput === null ||
            rolloutInput === String(rolloutState.percentage)
          }
          onClick={handleUpdateRollout}
        >
          Apply
        </Button>
        <Button
          size="icon"
          variant="outline"
          title="Complete rollout — switch channel to new branch"
          disabled={isUpdatingRollout}
          onClick={handleCompleteRollout}
        >
          <CircleCheckIcon strokeWidth={2} />
        </Button>
        <Button
          size="icon"
          variant="outline"
          title="Revert rollout — keep original branch"
          disabled={isUpdatingRollout}
          onClick={handleRevertRollout}
        >
          <Undo2Icon strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
};

const StartRolloutControls = ({
  channel,
  branches,
  invalidateChannels,
}: BranchRolloutControlsProps) => {
  const [rolloutBranchId, setRolloutBranchId] = useState("");
  const [rolloutInput, setRolloutInput] = useState("");
  const [isStartingRollout, setIsStartingRollout] = useState(false);
  const createBranchRolloutMutation = useApiMutation({
    mutationFn: async (input: { newBranchId: string; percentage: number }) =>
      createBranchRollout(channel.id, input),
    onSuccess: async (_, input) => {
      toastManager.add({
        title: `Branch rollout started at ${input.percentage}%`,
        type: "success",
      });
      await invalidateChannels();
      setIsStartingRollout(false);
      setRolloutBranchId("");
      setRolloutInput("");
    },
  });
  const isSubmitting = createBranchRolloutMutation.isPending;

  const handleStartRollout = () => {
    const percentage = Number.parseInt(rolloutInput, 10);
    if (!rolloutBranchId) {
      toastManager.add({ title: "Select a target branch", type: "error" });
      return;
    }
    if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
      toastManager.add({ title: "Rollout percentage must be between 1 and 100", type: "error" });
      return;
    }
    createBranchRolloutMutation.mutate({ newBranchId: rolloutBranchId, percentage });
  };

  if (!isStartingRollout) {
    return (
      <Button
        variant="outline"
        className="w-fit"
        onClick={() => {
          setIsStartingRollout(true);
        }}
      >
        <RocketIcon strokeWidth={2} data-icon="inline-start" />
        Start Rollout
      </Button>
    );
  }

  const targetBranches = branches.filter((branch) => branch.id !== channel.branchId);
  const targetBranchLabels: Record<string, string> = Object.fromEntries(
    targetBranches.map((branch) => [branch.id, branch.name]),
  );

  return (
    <div className="flex items-center gap-2">
      <Select
        items={targetBranchLabels}
        value={rolloutBranchId}
        onValueChange={(value) => {
          if (value === null) {
            return;
          }
          setRolloutBranchId(value);
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
      <Input
        type="number"
        min={1}
        max={100}
        placeholder="%"
        value={rolloutInput}
        onChange={(event) => {
          setRolloutInput(event.target.value);
        }}
        className="w-20"
        disabled={isSubmitting}
      />
      <Button
        variant="default"
        disabled={isSubmitting || !rolloutBranchId || !rolloutInput}
        onClick={handleStartRollout}
      >
        Start
      </Button>
      <Button
        variant="ghost"
        disabled={isSubmitting}
        onClick={() => {
          setIsStartingRollout(false);
          setRolloutBranchId("");
          setRolloutInput("");
        }}
      >
        Cancel
      </Button>
    </div>
  );
};

interface ChannelCardProps {
  readonly channel: typeof Channel.Type;
  readonly orgId: string;
  readonly projectId: string;
  readonly projectSlug: string;
  readonly branches: readonly BranchItem[];
  readonly compatibleBuilds: readonly {
    readonly build: BuildWithSyntheticChannels;
    readonly status: SyntheticBuildChannel;
  }[];
  readonly missingRuntimeVersions: readonly (typeof MissingRuntimeVersionBuild.Type)[];
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
              <a
                href={`/projects/${projectSlug}/channels/${channel.id}`}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                View details
              </a>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {channel.isPaused && <Badge variant="warning">Paused</Badge>}
            <Button variant="ghost" size="icon" disabled={isToggling} onClick={handleTogglePause}>
              {channel.isPaused ? <PlayIcon strokeWidth={2} /> : <PauseIcon strokeWidth={2} />}
            </Button>
            <DeleteChannelDialog channel={channel} orgId={orgId} projectId={projectId} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-4" />
          <Select
            items={branchLabels}
            value={channel.branchId}
            disabled={rolloutState !== null}
            onValueChange={(value) => {
              if (value) {
                handleRelink(value);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue>{linkedBranch?.name ?? channel.branchId}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>

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
