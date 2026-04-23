import {
  branchesQueryOptions,
  buildCompatibilityMatrixQueryOptions,
  channelsQueryOptions,
} from "@better-update/api-client/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQuery } from "@tanstack/react-query";
import { SatelliteIcon } from "lucide-react";

import { ChannelCard } from "./-channel-card";
import {
  getCompatibleBuildsForChannel,
  getMissingRuntimeVersionsForChannel,
} from "./-channel-compatibility-helpers";
import { CreateChannelDialog } from "./-create-channel-dialog";

const ChannelsEmptyState = () => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SatelliteIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No channels yet</EmptyTitle>
      <EmptyDescription>Create your first channel to start distributing updates.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export const ChannelsTab = ({
  orgId,
  projectId,
  projectSlug,
}: {
  orgId: string;
  projectId: string;
  projectSlug: string;
}) => {
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
              projectSlug={projectSlug}
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
