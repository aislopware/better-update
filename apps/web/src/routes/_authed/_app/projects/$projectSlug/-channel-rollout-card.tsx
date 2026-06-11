import {
  completeBranchRollout,
  createBranchRollout,
  revertBranchRollout,
  updateBranchRollout,
  updateChannel,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@better-update/ui/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@better-update/ui/components/ui/input-group";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Separator } from "@better-update/ui/components/ui/separator";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, GitBranchIcon, RocketIcon, Undo2Icon } from "lucide-react";
import { useState } from "react";

import type { Channel } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";
import type { ChangeEvent } from "react";

import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { parseRolloutState } from "./-channel-rollout-state";
import { RolloutSplitDiagram } from "./-rollout-split-diagram";
import { invalidateChannels as invalidateChannelsHelper } from "./-update-helpers";

interface RolloutSectionProps {
  readonly channel: Channel;
  readonly branches: readonly BranchItem[];
  readonly invalidateChannels: () => Promise<void>;
}

const ActiveRolloutSection = ({
  channel,
  branches,
  rolloutState,
  invalidateChannels,
}: RolloutSectionProps & {
  readonly rolloutState: { targetBranchId: string; percentage: number };
}) => {
  const [rolloutDraft, setRolloutDraft] = useState<string | undefined>(undefined);
  const currentPercentage = String(rolloutState.percentage);
  const rolloutInput = rolloutDraft ?? currentPercentage;
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

  const currentBranch = branches.find((branch) => branch.id === channel.branchId);
  const oldBranchName = currentBranch?.name ?? channel.branchId.slice(0, 8);
  const targetBranch = branches.find((branch) => branch.id === rolloutState.targetBranchId);
  const newBranchName = targetBranch?.name ?? rolloutState.targetBranchId.slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Branch rollout</span>
        <Badge variant="secondary">Active</Badge>
      </div>
      <RolloutSplitDiagram
        oldBranchName={oldBranchName}
        newBranchName={newBranchName}
        newBranchPercentage={rolloutState.percentage}
      />
      <Field>
        <FieldLabel htmlFor="rollout-percentage">Rollout percentage</FieldLabel>
        <div className="flex items-center gap-2">
          <InputGroup className="w-28">
            <InputGroupInput
              id="rollout-percentage"
              type="number"
              min={1}
              max={100}
              value={rolloutInput}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setRolloutDraft(event.target.value);
              }}
              disabled={isUpdatingRollout}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText>%</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
          <Button
            type="button"
            variant="outline"
            loading={updateBranchRolloutMutation.isPending}
            disabled={isUpdatingRollout || rolloutInput === currentPercentage}
            onClick={handleUpdateRollout}
          >
            Apply
          </Button>
        </div>
        <FieldDescription>Share of clients served {newBranchName}.</FieldDescription>
      </Field>
      <Separator />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            loading={completeBranchRolloutMutation.isPending}
            disabled={isUpdatingRollout}
            onClick={() => {
              completeBranchRolloutMutation.mutate();
            }}
          >
            <CircleCheckIcon strokeWidth={2} data-icon="inline-start" />
            Complete rollout
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={revertBranchRolloutMutation.isPending}
            disabled={isUpdatingRollout}
            onClick={() => {
              revertBranchRolloutMutation.mutate();
            }}
          >
            <Undo2Icon strokeWidth={2} data-icon="inline-start" />
            Revert
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Complete switches every client to {newBranchName}. Revert restores {oldBranchName}.
        </p>
      </div>
    </div>
  );
};

const StartRolloutForm = ({
  channel,
  branches,
  onDone,
  invalidateChannels,
}: RolloutSectionProps & { readonly onDone: () => void }) => {
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
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="branchId">
          {(field) => (
            <Field>
              <FieldLabel>Target branch</FieldLabel>
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
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a branch" />
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
              <FieldDescription>Branch the rollout shifts clients to.</FieldDescription>
            </Field>
          )}
        </form.Field>
        <form.Field name="percentage">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="rollout-start-percentage">Initial percentage</FieldLabel>
              <InputGroup className="w-28">
                <InputGroupInput
                  id="rollout-start-percentage"
                  type="number"
                  min={1}
                  max={100}
                  placeholder="10"
                  value={field.state.value}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    field.handleChange(event.target.value);
                  }}
                  disabled={createBranchRolloutMutation.isPending}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>%</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>Share of clients to start with.</FieldDescription>
            </Field>
          )}
        </form.Field>
      </div>
      <div className="flex items-center gap-2">
        <form.Subscribe
          selector={(state) =>
            [state.values.branchId, state.values.percentage, state.isSubmitting] as const
          }
        >
          {([branchId, percentage, isSubmitting]) => (
            <Button type="submit" disabled={!branchId || !percentage} loading={isSubmitting}>
              <RocketIcon strokeWidth={2} data-icon="inline-start" />
              Start rollout
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
      </div>
    </form>
  );
};

const StartRolloutSection = (props: RolloutSectionProps) => {
  const [isStartingRollout, setIsStartingRollout] = useState(false);
  const targetBranchCount = props.branches.filter(
    (branch) => branch.id !== props.channel.branchId,
  ).length;
  const noTargetsReason =
    targetBranchCount === 0 ? "Create another branch first to enable rollouts" : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Branch rollout</span>
        <p className="text-muted-foreground text-sm">
          Gradually shift a share of clients to another branch before switching over completely.
        </p>
      </div>
      {isStartingRollout ? (
        <StartRolloutForm
          channel={props.channel}
          branches={props.branches}
          invalidateChannels={props.invalidateChannels}
          onDone={() => {
            setIsStartingRollout(false);
          }}
        />
      ) : (
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
                  Start rollout
                </Button>
              </span>
            }
          />
          <TooltipPopup>{noTargetsReason ?? "Start a branch rollout"}</TooltipPopup>
        </Tooltip>
      )}
    </div>
  );
};

interface ChannelRolloutCardProps {
  readonly channel: Channel;
  readonly orgId: string;
  readonly projectId: string;
  readonly branches: readonly BranchItem[];
}

export const ChannelRolloutCard = ({
  channel,
  orgId,
  projectId,
  branches,
}: ChannelRolloutCardProps) => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branch & rollout</CardTitle>
        <CardDescription>
          Control which branch this channel serves and shift traffic gradually between branches.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field>
          <FieldLabel>Linked branch</FieldLabel>
          <Select
            items={branchLabels}
            value={channel.branchId}
            disabled={rolloutState !== null || updateChannelMutation.isPending}
            onValueChange={(value) => {
              if (value) {
                updateChannelMutation.mutate(value);
              }
            }}
          >
            <SelectTrigger className="w-full sm:max-w-xs">
              <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-4" />
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
          <FieldDescription>
            {rolloutState
              ? "Locked while a rollout is active — complete or revert the rollout first."
              : "Clients on this channel receive updates published to this branch."}
          </FieldDescription>
        </Field>
        <Separator />
        {rolloutState ? (
          <ActiveRolloutSection
            channel={channel}
            branches={branches}
            rolloutState={rolloutState}
            invalidateChannels={invalidateChannels}
          />
        ) : (
          <StartRolloutSection
            channel={channel}
            branches={branches}
            invalidateChannels={invalidateChannels}
          />
        )}
      </CardContent>
    </Card>
  );
};
