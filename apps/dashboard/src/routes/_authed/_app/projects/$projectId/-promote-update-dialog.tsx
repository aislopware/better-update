import { getApiError } from "@better-update/api-client";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Rocket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Either, Effect } from "effect";
import { useState } from "react";
import { toast } from "sonner";

import type { Channel, Update } from "@better-update/api";

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
  const [targetChannelId, setTargetChannelId] = useState("");
  const [isPromoting, setIsPromoting] = useState(false);

  const handlePromote = async () => {
    if (!targetChannelId) {
      return;
    }
    setIsPromoting(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: async () =>
            republishUpdate({
              sourceUpdateId: update.id,
              targetChannelId,
            }),
          catch: (error) => error,
        }),
      ),
    );
    if (Either.isLeft(result)) {
      toast.error(getApiError(result.left));
      setIsPromoting(false);
      return;
    }
    toast.success("Update promoted successfully");
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "updates"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "build-compatibility-matrix"],
      }),
    ]);
    setIsPromoting(false);
    setTargetChannelId("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setTargetChannelId("");
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
              value={targetChannelId}
              onValueChange={(value) => {
                if (value) {
                  setTargetChannelId(value);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    {channel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handlePromote} disabled={!targetChannelId || isPromoting}>
            <HugeiconsIcon icon={Rocket01Icon} strokeWidth={2} className="size-4" />
            {isPromoting ? "Promoting..." : "Promote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
