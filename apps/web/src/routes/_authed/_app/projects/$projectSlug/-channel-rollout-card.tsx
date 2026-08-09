import {
  branchesQueryOptions,
  completeBranchRollout,
  createBranchRollout,
  revertBranchRollout,
  updateBranchRollout,
  updateChannel,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { Button } from "@better-update/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/card";
import { Field } from "@better-update/ui/components/field";
import { InputGroup } from "@better-update/ui/components/input-group";
import { Separator } from "@better-update/ui/components/separator";
import { toast } from "@better-update/ui/components/toast";
import { Tooltip } from "@better-update/ui/components/tooltip";
import { ArrowCounterClockwiseIcon, CheckCircleIcon, RocketIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { Channel } from "@better-update/api";
import type { ChangeEvent } from "react";

import {
  ServerSearchCombobox,
  useServerSearchList,
} from "../../../../../components/server-search-combobox";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";
import { parseRolloutState } from "./-channel-rollout-state";
import { RolloutSplitDiagram } from "./-rollout-split-diagram";
import { invalidateChannels as invalidateChannelsHelper } from "./-update-helpers";

// Server-searched branch picker: default list = first page, typing searches all branches.
const useBranchSearchList = (orgId: string, projectId: string) =>
  useServerSearchList((query) =>
    branchesQueryOptions(
      orgId,
      projectId,
      query ? { limit: DROPDOWN_FETCH_LIMIT, query } : { limit: DROPDOWN_FETCH_LIMIT },
    ),
  );

type BranchSearchList = ReturnType<typeof useBranchSearchList>;

interface RolloutSectionProps {
  readonly channel: Channel;
  readonly invalidateChannels: () => Promise<void>;
}

const ActiveRolloutSection = ({
  channel,
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
      toast.success(`Rollout updated to ${percentage}%`);
      await invalidateChannels();
    },
  });
  const completeBranchRolloutMutation = useApiMutation({
    mutationFn: async () => completeBranchRollout(channel.id),
    onSuccess: async () => {
      setRolloutDraft(undefined);
      toast.success("Rollout completed — channel now serves the new branch");
      await invalidateChannels();
    },
  });
  const revertBranchRolloutMutation = useApiMutation({
    mutationFn: async () => revertBranchRollout(channel.id),
    onSuccess: async () => {
      setRolloutDraft(undefined);
      toast.success("Rollout reverted — channel restored to original branch");
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
      toast.error("Rollout percentage must be between 1 and 100");
      return;
    }
    updateBranchRolloutMutation.mutate(percentage);
  };

  const oldBranchName = channel.branchName ?? channel.branchId.slice(0, 8);
  const newBranchName = channel.rolloutTargetBranchName ?? rolloutState.targetBranchId.slice(0, 8);

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
      <Field label="Rollout percentage" description={<>Share of clients served {newBranchName}.</>}>
        <div className="flex items-center gap-2">
          <InputGroup className="w-28" disabled={isUpdatingRollout}>
            <InputGroup.Input
              id="rollout-percentage"
              aria-label="Rollout percentage"
              type="number"
              min={1}
              max={100}
              value={rolloutInput}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setRolloutDraft(event.target.value);
              }}
            />
            <InputGroup.Suffix>%</InputGroup.Suffix>
          </InputGroup>
          <Button
            type="button"
            variant="secondary"
            disabled={isUpdatingRollout || rolloutInput === currentPercentage}
            onClick={handleUpdateRollout}
            loading={updateBranchRolloutMutation.isPending}
          >
            Apply
          </Button>
        </div>
      </Field>
      <Separator />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            type="button"
            disabled={isUpdatingRollout}
            onClick={() => {
              completeBranchRolloutMutation.mutate();
            }}
            loading={completeBranchRolloutMutation.isPending}
            icon={<CheckCircleIcon weight="bold" />}
          >
            Complete rollout
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isUpdatingRollout}
            onClick={() => {
              revertBranchRolloutMutation.mutate();
            }}
            loading={revertBranchRolloutMutation.isPending}
            icon={<ArrowCounterClockwiseIcon weight="bold" />}
          >
            Revert
          </Button>
        </div>
        <p className="text-kumo-subtle text-sm">
          Complete switches every client to {newBranchName}. Revert restores {oldBranchName}.
        </p>
      </div>
    </div>
  );
};

const StartRolloutForm = ({
  channel,
  branchList,
  onDone,
  invalidateChannels,
}: RolloutSectionProps & {
  readonly branchList: BranchSearchList;
  readonly onDone: () => void;
}) => {
  const createBranchRolloutMutation = useApiMutation({
    mutationFn: async (input: { newBranchId: string; percentage: number }) =>
      createBranchRollout(channel.id, input),
    onSuccess: async (_, input) => {
      toast.success(`Branch rollout started at ${input.percentage}%`);
      await invalidateChannels();
      onDone();
    },
  });

  const form = useForm({
    defaultValues: { branchId: "", percentage: "" },
    onSubmit: async ({ value }) => {
      const percentage = Number.parseInt(value.percentage, 10);
      if (!value.branchId) {
        toast.error("Select a target branch");
        return;
      }
      if (Number.isNaN(percentage) || percentage < 1 || percentage > 100) {
        toast.error("Rollout percentage must be between 1 and 100");
        return;
      }
      await safeSubmit(
        createBranchRolloutMutation.mutateAsync({ newBranchId: value.branchId, percentage }),
      );
    },
  });

  const targetBranchOptions = branchList.items
    .filter((branch) => branch.id !== channel.branchId)
    .map((branch) => ({ value: branch.id, label: branch.name }));

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
            <Field label="Target branch" description="Branch the rollout shifts clients to.">
              <ServerSearchCombobox
                value={field.state.value}
                onValueChange={(next) => {
                  field.handleChange(next);
                }}
                options={targetBranchOptions}
                search={branchList.search}
                onSearchChange={branchList.handleSearchChange}
                isPending={branchList.isPending}
                defaultListTruncated={branchList.defaultListTruncated}
                placeholder="Select a branch"
                searchPlaceholder="Search branches…"
                emptyMessage="No branches found."
                ariaLabel="Target branch"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="percentage">
          {(field) => (
            <Field label="Initial percentage" description="Share of clients to start with.">
              <InputGroup className="w-28" disabled={createBranchRolloutMutation.isPending}>
                <InputGroup.Input
                  id="rollout-start-percentage"
                  aria-label="Initial percentage"
                  type="number"
                  min={1}
                  max={100}
                  placeholder="10"
                  value={field.state.value}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    field.handleChange(event.target.value);
                  }}
                />
                <InputGroup.Suffix>%</InputGroup.Suffix>
              </InputGroup>
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
            <Button
              variant="primary"
              type="submit"
              disabled={!branchId || !percentage || isSubmitting}
              loading={isSubmitting}
              icon={<RocketIcon weight="bold" />}
            >
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

const StartRolloutSection = (
  props: RolloutSectionProps & { readonly orgId: string; readonly projectId: string },
) => {
  const [isStartingRollout, setIsStartingRollout] = useState(false);
  const branchList = useBranchSearchList(props.orgId, props.projectId);
  // Only a settled, untruncated default page with no other branch proves there is no target.
  const hasNoTargets =
    !branchList.isPending &&
    !branchList.defaultListTruncated &&
    !branchList.items.some((branch) => branch.id !== props.channel.branchId);
  const noTargetsReason = hasNoTargets
    ? "Create another branch first to enable rollouts"
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Branch rollout</span>
        <p className="text-kumo-subtle text-sm">
          Gradually shift a share of clients to another branch before switching over completely.
        </p>
      </div>
      {isStartingRollout ? (
        <StartRolloutForm
          channel={props.channel}
          branchList={branchList}
          invalidateChannels={props.invalidateChannels}
          onDone={() => {
            setIsStartingRollout(false);
          }}
        />
      ) : (
        <Tooltip
          content={noTargetsReason ?? "Start a branch rollout"}
          render={<span className="inline-flex w-fit" />}
        >
          <Button
            variant="secondary"
            disabled={noTargetsReason !== undefined}
            onClick={() => {
              setIsStartingRollout(true);
            }}
          >
            <RocketIcon weight="bold" />
            Start rollout
          </Button>
        </Tooltip>
      )}
    </div>
  );
};

const LinkedBranchField = ({
  channel,
  orgId,
  projectId,
  disabled,
  isRolloutActive,
  onRelink,
}: {
  readonly channel: Channel;
  readonly orgId: string;
  readonly projectId: string;
  readonly disabled: boolean;
  readonly isRolloutActive: boolean;
  readonly onRelink: (branchId: string) => void;
}) => {
  const branchList = useBranchSearchList(orgId, projectId);
  const options = branchList.items.map((branch) => ({ value: branch.id, label: branch.name }));
  // Seed the current selection so its embedded name renders even off-page.
  const optionsWithCurrent = options.some((option) => option.value === channel.branchId)
    ? options
    : [{ value: channel.branchId, label: channel.branchName ?? channel.branchId }, ...options];

  return (
    <Field
      label="Linked branch"
      description={
        isRolloutActive
          ? "Locked while a rollout is active — complete or revert the rollout first."
          : "Clients on this channel receive updates published to this branch."
      }
    >
      <div className="w-full sm:max-w-xs">
        <ServerSearchCombobox
          value={channel.branchId}
          onValueChange={(next) => {
            if (next !== channel.branchId) {
              onRelink(next);
            }
          }}
          options={optionsWithCurrent}
          search={branchList.search}
          onSearchChange={branchList.handleSearchChange}
          isPending={branchList.isPending}
          defaultListTruncated={branchList.defaultListTruncated}
          placeholder="Select a branch"
          searchPlaceholder="Search branches…"
          emptyMessage="No branches found."
          ariaLabel="Linked branch"
          disabled={disabled}
        />
      </div>
    </Field>
  );
};

interface ChannelRolloutCardProps {
  readonly channel: Channel;
  readonly orgId: string;
  readonly projectId: string;
}

export const ChannelRolloutCard = ({ channel, orgId, projectId }: ChannelRolloutCardProps) => {
  const queryClient = useQueryClient();

  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;

  const invalidateChannels = async (): Promise<void> =>
    invalidateChannelsHelper(queryClient, orgId, projectId);
  const updateChannelMutation = useApiMutation({
    mutationFn: async (branchId: string) => updateChannel(channel.id, { branchId }),
    onSuccess: async () => {
      toast.success("Channel relinked");
      await invalidateChannels();
    },
  });

  return (
    <Card>
      {/* No description: every control below already carries its own hint —
          what locks the branch picker, what the percentage is a share of, what
          completing does — so a fourth sentence saying "control which branch
          this channel serves" only pushed them further down. */}
      <CardHeader>
        <CardTitle>Branch & rollout</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <LinkedBranchField
          channel={channel}
          orgId={orgId}
          projectId={projectId}
          disabled={rolloutState !== null || updateChannelMutation.isPending}
          isRolloutActive={rolloutState !== null}
          onRelink={(branchId) => {
            updateChannelMutation.mutate(branchId);
          }}
        />
        <Separator />
        {rolloutState ? (
          <ActiveRolloutSection
            channel={channel}
            rolloutState={rolloutState}
            invalidateChannels={invalidateChannels}
          />
        ) : (
          <StartRolloutSection
            channel={channel}
            orgId={orgId}
            projectId={projectId}
            invalidateChannels={invalidateChannels}
          />
        )}
      </CardContent>
    </Card>
  );
};
