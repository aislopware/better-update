import { getApiError } from "@better-update/api-client";
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import {
  CheckmarkCircle02Icon,
  GitBranchIcon,
  PauseIcon,
  PlayIcon,
  Rocket01Icon,
  SatelliteIcon,
  UndoIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Channel } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

import { DeleteChannelDialog } from "./-delete-channel-dialog";

interface RolloutEntry {
  branchId: string;
  branchMappingLogic: string;
}

interface BranchMappingShape {
  data: RolloutEntry[];
}

const isBranchMapping = (value: unknown): value is BranchMappingShape =>
  typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data);

const parseRolloutState = (json: string): { targetBranchId: string; percentage: number } | null => {
  // eslint-disable-next-line functional/no-try-statements -- graceful fallback for malformed server JSON
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isBranchMapping(parsed) || parsed.data.length === 0) {
      return null;
    }
    const [first] = parsed.data;
    if (!first) {
      return null;
    }
    const match = /hash_lt\(mappingId,\s*([\d.]+)\)/.exec(first.branchMappingLogic);
    return match?.[1]
      ? {
          targetBranchId: first.branchId,
          percentage: Math.round(Number.parseFloat(match[1]) * 100),
        }
      : null;
  } catch {
    return null;
  }
};

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
  const [isUpdatingRollout, setIsUpdatingRollout] = useState(false);
  const rolloutTargetBranch = branches.find((branch) => branch.id === rolloutState.targetBranchId);

  const handleUpdateRollout = async () => {
    const percentage = Number.parseInt(rolloutInput ?? String(rolloutState.percentage), 10);
    if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
      toast.error("Rollout percentage must be between 1 and 100");
      return;
    }
    setIsUpdatingRollout(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await updateBranchRollout(channel.id, { percentage });
      toast.success(`Rollout updated to ${percentage}%`);
      await invalidateChannels();
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsUpdatingRollout(false);
    }
  };

  const handleCompleteRollout = async () => {
    setIsUpdatingRollout(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await completeBranchRollout(channel.id);
      toast.success("Rollout completed — channel now serves the new branch");
      await invalidateChannels();
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsUpdatingRollout(false);
    }
  };

  const handleRevertRollout = async () => {
    setIsUpdatingRollout(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await revertBranchRollout(channel.id);
      toast.success("Rollout reverted — channel restored to original branch");
      await invalidateChannels();
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsUpdatingRollout(false);
    }
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
          size="sm"
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
          className="size-8"
          title="Complete rollout — switch channel to new branch"
          disabled={isUpdatingRollout}
          onClick={handleCompleteRollout}
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          title="Revert rollout — keep original branch"
          disabled={isUpdatingRollout}
          onClick={handleRevertRollout}
        >
          <HugeiconsIcon icon={UndoIcon} strokeWidth={2} className="size-4" />
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
  const [isStartingRollout, setIsStartingRollout] = useState(false);
  const [rolloutBranchId, setRolloutBranchId] = useState("");
  const [rolloutInput, setRolloutInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStartRollout = async () => {
    const percentage = Number.parseInt(rolloutInput, 10);
    if (!rolloutBranchId) {
      toast.error("Select a target branch");
      return;
    }
    if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
      toast.error("Rollout percentage must be between 1 and 100");
      return;
    }
    setIsSubmitting(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await createBranchRollout(channel.id, { newBranchId: rolloutBranchId, percentage });
      toast.success(`Branch rollout started at ${percentage}%`);
      await invalidateChannels();
      setIsStartingRollout(false);
      setRolloutBranchId("");
      setRolloutInput("");
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isStartingRollout) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          setIsStartingRollout(true);
        }}
      >
        <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} className="mr-1 size-4" />
        Start Rollout
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={rolloutBranchId}
        onValueChange={(value) => {
          setRolloutBranchId(value ?? "");
        }}
      >
        <SelectTrigger size="sm">
          <SelectValue placeholder="Target branch" />
        </SelectTrigger>
        <SelectContent>
          {branches
            .filter((branch) => branch.id !== channel.branchId)
            .map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
        </SelectContent>
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
        size="sm"
        variant="default"
        disabled={isSubmitting || !rolloutBranchId || !rolloutInput}
        onClick={handleStartRollout}
      >
        Start
      </Button>
      <Button
        size="sm"
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
  readonly branches: readonly BranchItem[];
}

export const ChannelCard = ({ channel, orgId, projectId, branches }: ChannelCardProps) => {
  const queryClient = useQueryClient();
  const [isToggling, setIsToggling] = useState(false);
  const linkedBranch = branches.find((branch) => branch.id === channel.branchId);

  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;

  const invalidateChannels = async () =>
    queryClient.invalidateQueries({
      queryKey: ["org", orgId, "projects", projectId, "channels"],
    });

  const handleRelink = async (branchId: string) => {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await updateChannel(channel.id, { branchId });
    } catch (error) {
      toast.error(getApiError(error));
      return;
    }

    toast.success("Channel relinked");
    await invalidateChannels();
  };

  const handleTogglePause = async () => {
    setIsToggling(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await (channel.isPaused ? resumeChannel(channel.id) : pauseChannel(channel.id));
      toast.success(channel.isPaused ? "Channel resumed" : "Channel paused");
      await invalidateChannels();
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={SatelliteIcon}
              strokeWidth={2}
              className="text-muted-foreground size-5"
            />
            <CardTitle className="text-base">{channel.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {channel.isPaused && <Badge variant="outline">Paused</Badge>}
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={isToggling}
              onClick={handleTogglePause}
            >
              <HugeiconsIcon
                icon={channel.isPaused ? PlayIcon : PauseIcon}
                strokeWidth={2}
                className="size-4"
              />
            </Button>
            <DeleteChannelDialog channel={channel} orgId={orgId} projectId={projectId} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={GitBranchIcon}
            strokeWidth={2}
            className="text-muted-foreground size-4"
          />
          <Select
            value={channel.branchId}
            disabled={rolloutState !== null}
            onValueChange={async (value) => {
              if (value) {
                await handleRelink(value);
              }
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue>{linkedBranch?.name ?? channel.branchId}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
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
      </CardContent>
    </Card>
  );
};
