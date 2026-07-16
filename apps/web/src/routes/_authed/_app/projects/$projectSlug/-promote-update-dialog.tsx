import { channelsQueryOptions, republishUpdate } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldLabel } from "@better-update/ui/components/ui/field";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { RocketIcon } from "lucide-react";
import { useState } from "react";

import type { Update } from "@better-update/api";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import {
  ServerSearchCombobox,
  useServerSearchList,
} from "../../../../../components/server-search-combobox";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";
import { invalidateUpdates } from "./-update-helpers";

interface PromoteUpdateDialogProps {
  readonly update: Update;
  readonly orgId: string;
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const TargetChannelCombobox = ({
  value,
  onValueChange,
  update,
  orgId,
  projectId,
}: {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly update: Update;
  readonly orgId: string;
  readonly projectId: string;
}) => {
  const list = useServerSearchList((query) =>
    channelsQueryOptions(
      orgId,
      projectId,
      query ? { limit: DROPDOWN_FETCH_LIMIT, query } : { limit: DROPDOWN_FETCH_LIMIT },
    ),
  );
  // The mutation republishes by channel NAME, and a channel already serving
  // this update's branch is not a valid promotion target.
  const options = list.items
    .filter((channel) => channel.branchId !== update.branchId)
    .map((channel) => ({ value: channel.name, label: channel.name }));

  return (
    <ServerSearchCombobox
      value={value}
      onValueChange={onValueChange}
      options={options}
      search={list.search}
      onSearchChange={list.handleSearchChange}
      isPending={list.isPending}
      defaultListTruncated={list.defaultListTruncated}
      placeholder="Select a channel"
      searchPlaceholder="Search channels…"
      emptyMessage="No eligible channels found."
      ariaLabel="Target channel"
    />
  );
};

const PromoteForm = ({
  update,
  orgId,
  projectId,
  onSuccess,
}: {
  readonly update: Update;
  readonly orgId: string;
  readonly projectId: string;
  readonly onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();

  const promoteUpdateMutation = useApiMutation({
    mutationFn: async (channelName: string) =>
      republishUpdate({
        sourceUpdateId: update.id,
        destinationChannel: channelName,
      }),
    onSuccess: async () => {
      toast.success("Update promoted successfully");
      await invalidateUpdates(queryClient, orgId, projectId);
      onSuccess();
    },
  });

  const form = useForm({
    defaultValues: { targetChannelName: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(promoteUpdateMutation.mutateAsync(value.targetChannelName));
    },
  });

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Source update</span>
          <div className="flex items-center gap-2 text-sm">
            <span>{update.message}</span>
            <PlatformBadge platform={update.platform} />
            <span className="text-muted-foreground">v{update.runtimeVersion}</span>
          </div>
        </div>
        <form.Field name="targetChannelName">
          {(field) => (
            <Field>
              <FieldLabel>Target channel</FieldLabel>
              <TargetChannelCombobox
                value={field.state.value}
                onValueChange={field.handleChange}
                update={update}
                orgId={orgId}
                projectId={projectId}
              />
            </Field>
          )}
        </form.Field>
      </div>
      <DialogFooter>
        <form.Subscribe
          selector={(state) => [state.values.targetChannelName, state.isSubmitting] as const}
        >
          {([targetChannelName, isSubmitting]) => (
            <Button type="submit" disabled={!targetChannelName || isSubmitting}>
              {isSubmitting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RocketIcon strokeWidth={2} data-icon="inline-start" />
              )}
              Promote
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const PromoteUpdateDialog = ({
  update,
  orgId,
  projectId,
  open,
  onOpenChange,
}: PromoteUpdateDialogProps) => {
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Promote update</DialogTitle>
          <DialogDescription>
            Republish this update to another channel with 100% rollout.
          </DialogDescription>
        </DialogHeader>
        <PromoteForm
          key={resetKey}
          update={update}
          orgId={orgId}
          projectId={projectId}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
