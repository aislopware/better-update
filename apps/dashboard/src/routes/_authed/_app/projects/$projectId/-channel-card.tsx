import { getApiError } from "@better-update/api-client";
import { pauseChannel, resumeChannel, updateChannel } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { GitBranchIcon, PauseIcon, PlayIcon, SatelliteIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Channel } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";

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
    } catch (error) {
      toast.error(getApiError(error));
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
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={GitBranchIcon}
            strokeWidth={2}
            className="text-muted-foreground size-4"
          />
          <Select
            value={channel.branchId}
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
      </CardContent>
    </Card>
  );
};
