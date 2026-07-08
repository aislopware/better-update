import { republishUpdate } from "@better-update/api-client/react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { RocketIcon } from "lucide-react";
import { useState } from "react";

import type { Channel, Update } from "@better-update/api";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import { safeSubmit, useApiMutation } from "../../../../../lib/use-api-mutation";
import { invalidateUpdates } from "./-update-helpers";

interface PromoteUpdateDialogProps {
  readonly update: Update;
  readonly channels: readonly Channel[];
  readonly orgId: string;
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface TargetChannelSelectProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly channels: readonly Channel[];
}

const TargetChannelSelect = ({ value, onChange, channels }: TargetChannelSelectProps) => {
  const channelLabels: Record<string, string> = Object.fromEntries(
    channels.map((channel) => [channel.name, channel.name]),
  );
  return (
    <Select
      items={channelLabels}
      value={value}
      onValueChange={(next) => {
        if (next) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a channel" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {channels.map((channel) => (
            <SelectItem key={channel.id} value={channel.name}>
              {channel.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

const PromoteForm = ({
  update,
  channels,
  orgId,
  projectId,
  onSuccess,
}: {
  readonly update: Update;
  readonly channels: readonly Channel[];
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
              <TargetChannelSelect
                value={field.state.value}
                onChange={field.handleChange}
                channels={channels}
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
  channels,
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
          channels={channels}
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
