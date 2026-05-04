import {
  branchesInfiniteQueryOptions,
  buildCompatibilityMatrixQueryOptions,
  buildsInfiniteQueryOptions,
  channelsInfiniteQueryOptions,
} from "@better-update/api-client/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { SatelliteIcon } from "lucide-react";

import { ChannelCard } from "./-channel-card";
import {
  getCompatibleBuildsForChannel,
  getMissingRuntimeVersionsForChannel,
} from "./-channel-compatibility-helpers";
import { CreateChannelDialog } from "./-create-channel-dialog";

const ChannelsEmptyState = () => (
  <Empty>
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
  const { data: channelsData } = useSuspenseInfiniteQuery(
    channelsInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
  );
  const { data: branchesData } = useSuspenseInfiniteQuery(
    branchesInfiniteQueryOptions(orgId, projectId, { limit: 100 }),
  );
  const { data: compatibilityData } = useSuspenseQuery(
    buildCompatibilityMatrixQueryOptions(orgId, projectId),
  );
  const { data: buildsData } = useSuspenseInfiniteQuery(
    buildsInfiniteQueryOptions(orgId, projectId),
  );
  const channels = channelsData.pages.flatMap((page) => page.items);
  const branches = branchesData.pages.flatMap((page) => page.items);
  const builds = buildsData.pages.flatMap((page) => page.items);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <CreateChannelDialog orgId={orgId} projectId={projectId} />
      </div>
      {channels.length === 0 ? (
        <ChannelsEmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              orgId={orgId}
              projectId={projectId}
              projectSlug={projectSlug}
              branches={branches}
              compatibleBuilds={getCompatibleBuildsForChannel(
                builds,
                compatibilityData,
                channel.id,
              )}
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
