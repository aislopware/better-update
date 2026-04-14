import {
  branchesQueryOptions,
  buildCompatibilityMatrixQueryOptions,
  channelsQueryOptions,
} from "@better-update/api-client/react";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { SatelliteIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";

import { ChannelCard } from "./-channel-card";
import {
  getCompatibleBuildsForChannel,
  getMissingRuntimeVersionsForChannel,
} from "./-channel-compatibility-helpers";
import { CreateChannelDialog } from "./-create-channel-dialog";

const ChannelsEmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <HugeiconsIcon
        icon={SatelliteIcon}
        strokeWidth={1.5}
        className="text-muted-foreground mb-4 size-12"
      />
      <p className="text-lg font-medium">No channels yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Create your first channel to start distributing updates.
      </p>
    </CardContent>
  </Card>
);

export const ChannelsTab = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const { data: channelsData } = useSuspenseQuery(channelsQueryOptions(orgId, projectId));
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));
  const { data: compatibilityData } = useSuspenseQuery(
    buildCompatibilityMatrixQueryOptions(orgId, projectId),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateChannelDialog orgId={orgId} projectId={projectId} />
      </div>
      {channelsData.items.length === 0 ? (
        <ChannelsEmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {channelsData.items.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              orgId={orgId}
              projectId={projectId}
              branches={branchesData.items}
              compatibleBuilds={getCompatibleBuildsForChannel(compatibilityData.rows, channel.id)}
              missingRuntimeVersions={getMissingRuntimeVersionsForChannel(
                compatibilityData.missingRuntimeVersions,
                channel.id,
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
};
