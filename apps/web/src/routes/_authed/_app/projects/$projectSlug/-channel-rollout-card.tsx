import {
  branchesQueryOptions,
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
import { Separator } from "@better-update/ui/components/ui/separator";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, RocketIcon, Undo2Icon } from "lucide-react";
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
            disabled={isUpdatingRollout || rolloutInput === currentPercentage}
            onClick={handleUpdateRollout}
          >
            {updateBranchRolloutMutation.isPending && <Spinner data-icon="inline-start" />}
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
            disabled={isUpdatingRollout}
            onClick={() => {
              completeBranchRolloutMutation.mutate();
            }}
          >
            {completeBranchRolloutMutation.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CircleCheckIcon strokeWidth={2} data-icon="inline-start" />
            )}
            Complete rollout
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isUpdatingRollout}
            onClick={() => {
              revertBranchRolloutMutation.mutate();
            }}
          >
            {revertBranchRolloutMutation.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Undo2Icon strokeWidth={2} data-icon="inline-start" />
            )}
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
            <Field>
              <FieldLabel>Target branch</FieldLabel>
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
            <Button type="submit" disabled={!branchId || !percentage || isSubmitting}>
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RocketIcon strokeWidth={2} data-icon="inline-start" />
              )}
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
        <p className="text-muted-foreground text-sm">
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
          <TooltipContent>{noTargetsReason ?? "Start a branch rollout"}</TooltipContent>
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
    <Field>
      <FieldLabel>Linked branch</FieldLabel>
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
      <FieldDescription>
        {isRolloutActive
          ? "Locked while a rollout is active — complete or revert the rollout first."
          : "Clients on this channel receive updates published to this branch."}
      </FieldDescription>
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
      <CardHeader>
        <CardTitle>Branch & rollout</CardTitle>
        <CardDescription>
          Control which branch this channel serves and shift traffic gradually between branches.
        </CardDescription>
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
