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
import { Either, Effect } from "effect";
import { useState } from "react";
import { toast } from "sonner";

import type {
  BuildCompatibilityChannel,
  BuildCompatibilityRow,
  Channel,
  MissingRuntimeVersionBuild,
} from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

import {
  CompatibleBuildsSection,
  DeleteChannelDialog,
  MissingMatchingBuilds,
  parseRolloutState,
} from "./-channel-card-sections";

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
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async () => updateBranchRollout(channel.id, { percentage }),
          catch: (error) => error,
        }),
      ),
    );
    if (Either.isLeft(result)) {
      toast.error(getApiError(result.left));
      setIsUpdatingRollout(false);
      return;
    }
    toast.success(`Rollout updated to ${percentage}%`);
    await invalidateChannels();
    setIsUpdatingRollout(false);
  };

  const handleCompleteRollout = async () => {
    setIsUpdatingRollout(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async () => completeBranchRollout(channel.id),
          catch: (error) => error,
        }),
      ),
    );
    if (Either.isLeft(result)) {
      toast.error(getApiError(result.left));
      setIsUpdatingRollout(false);
      return;
    }
    toast.success("Rollout completed — channel now serves the new branch");
    await invalidateChannels();
    setIsUpdatingRollout(false);
  };

  const handleRevertRollout = async () => {
    setIsUpdatingRollout(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async () => revertBranchRollout(channel.id),
          catch: (error) => error,
        }),
      ),
    );
    if (Either.isLeft(result)) {
      toast.error(getApiError(result.left));
      setIsUpdatingRollout(false);
      return;
    }
    toast.success("Rollout reverted — channel restored to original branch");
    await invalidateChannels();
    setIsUpdatingRollout(false);
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
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async () =>
            createBranchRollout(channel.id, { newBranchId: rolloutBranchId, percentage }),
          catch: (error) => error,
        }),
      ),
    );
    if (Either.isLeft(result)) {
      toast.error(getApiError(result.left));
      setIsSubmitting(false);
      return;
    }
    toast.success(`Branch rollout started at ${percentage}%`);
    await invalidateChannels();
    setIsStartingRollout(false);
    setRolloutBranchId("");
    setRolloutInput("");
    setIsSubmitting(false);
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
  readonly compatibleBuilds: readonly {
    readonly build: typeof BuildCompatibilityRow.Type;
    readonly status: typeof BuildCompatibilityChannel.Type;
  }[];
  readonly missingRuntimeVersions: readonly (typeof MissingRuntimeVersionBuild.Type)[];
}

export const ChannelCard = ({
  channel,
  orgId,
  projectId,
  branches,
  compatibleBuilds,
  missingRuntimeVersions,
}: ChannelCardProps) => {
  const queryClient = useQueryClient();
  const [isToggling, setIsToggling] = useState(false);
  const linkedBranch = branches.find((branch) => branch.id === channel.branchId);

  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;

  const invalidateChannels = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "channels"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
      }),
    ]);
  };

  const handleRelink = async (branchId: string) => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async () => updateChannel(channel.id, { branchId }),
          catch: (error) => error,
        }),
      ),
    );
    if (Either.isLeft(result)) {
      toast.error(getApiError(result.left));
      return;
    }

    toast.success("Channel relinked");
    await invalidateChannels();
  };

  const handleTogglePause = async () => {
    setIsToggling(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async () =>
            channel.isPaused ? resumeChannel(channel.id) : pauseChannel(channel.id),
          catch: (error) => error,
        }),
      ),
    );
    if (Either.isLeft(result)) {
      toast.error(getApiError(result.left));
      setIsToggling(false);
      return;
    }
    toast.success(channel.isPaused ? "Channel resumed" : "Channel paused");
    await invalidateChannels();
    setIsToggling(false);
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
        <CompatibleBuildsSection compatibleBuilds={compatibleBuilds} />
        <MissingMatchingBuilds missingRuntimeVersions={missingRuntimeVersions} />
      </CardContent>
    </Card>
  );
};
