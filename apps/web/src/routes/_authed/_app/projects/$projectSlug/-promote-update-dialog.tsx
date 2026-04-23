import { republishUpdate } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { RocketIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { Channel, Update } from "@better-update/api";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { invalidateUpdates } from "./-update-helpers";

interface PromoteUpdateDialogProps {
  readonly update: typeof Update.Type;
  readonly channels: readonly (typeof Channel.Type)[];
  readonly orgId: string;
  readonly projectId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export const PromoteUpdateDialog = ({
  update,
  channels,
  orgId,
  projectId,
  open,
  onOpenChange,
}: PromoteUpdateDialogProps) => {
  const queryClient = useQueryClient();
  const [targetChannelName, setTargetChannelName] = useState("");
  const promoteUpdateMutation = useApiMutation({
    mutationFn: async (channelName: string) =>
      republishUpdate({
        sourceUpdateId: update.id,
        destinationChannel: channelName,
      }),
    onSuccess: async () => {
      toast.success("Update promoted successfully");
      await invalidateUpdates(queryClient, orgId, projectId);
      setTargetChannelName("");
      onOpenChange(false);
    },
  });

  const handlePromote = () => {
    if (!targetChannelName) {
      return;
    }
    promoteUpdateMutation.mutate(targetChannelName);
  };

  const channelLabels: Record<string, string> = Object.fromEntries(
    channels.map((channel) => [channel.name, channel.name]),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setTargetChannelName("");
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote update</DialogTitle>
          <DialogDescription>
            Republish this update to another channel with 100% rollout.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Source update</span>
            <div className="flex items-center gap-2 text-sm">
              <span>{update.message}</span>
              <Badge variant="outline">{update.platform}</Badge>
              <span className="text-muted-foreground">v{update.runtimeVersion}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Target channel</span>
            <Select
              items={channelLabels}
              value={targetChannelName}
              onValueChange={(value) => {
                if (value) {
                  setTargetChannelName(value);
                }
              }}
            >
              <SelectTrigger>
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
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handlePromote}
            disabled={!targetChannelName || promoteUpdateMutation.isPending}
          >
            <RocketIcon strokeWidth={2} data-icon="inline-start" />
            {promoteUpdateMutation.isPending ? "Promoting..." : "Promote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
