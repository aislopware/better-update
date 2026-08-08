import { getTypedApiError } from "@better-update/api-client";
import {
  buildCompatibilityMatrixQueryOptions,
  channelCompatibleBuildsQueryOptions,
  channelQueryOptions,
  pauseChannel,
  resumeChannel,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { Button } from "@better-update/ui/components/button";
import { toast } from "@better-update/ui/components/toast";
import { BroadcastIcon, GitBranchIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient, useSuspenseQueries } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import type { Channel } from "@better-update/api";

import { ChannelBuildsCard, VISIBLE_BUILD_LIMIT } from "../-channel-builds-card";
import {
  getMissingRuntimeVersionsForChannel,
  toCompatibleBuildEntries,
} from "../-channel-compatibility-helpers";
import { ChannelRolloutCard } from "../-channel-rollout-card";
import { ChannelStatusBadge } from "../-channel-status-badge";
import { ChannelUpdatesCard, VISIBLE_UPDATE_LIMIT } from "../-channel-updates-card";
import { DeleteChannelDialog } from "../-delete-channel-dialog";
import { invalidateChannels } from "../-update-helpers";
import { DetailHeader, DetailNotFound } from "../../../../../../components/detail-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { DetailCardSkeleton } from "../../../../../../components/skeletons";
import { CopyableId } from "../../../../../../lib/copy-button";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { RouterLinkButton } from "../../../../../../lib/router-link-button";
import { useApiMutation } from "../../../../../../lib/use-api-mutation";

const ChannelNotFoundState = ({ projectSlug }: { projectSlug: string }) => (
  <DetailNotFound
    icon={<BroadcastIcon />}
    title="Channel not found in this project"
    description="The requested channel does not belong to this project or was removed."
    backLink={
      <RouterLinkButton to="/projects/$projectSlug" params={{ projectSlug }}>
        Back to project
      </RouterLinkButton>
    }
  />
);

const ChannelHeaderActions = ({
  channel,
  orgId,
  projectId,
}: {
  channel: Channel;
  orgId: string;
  projectId: string;
}) => {
  const queryClient = useQueryClient();
  const togglePauseMutation = useApiMutation({
    mutationFn: async () =>
      channel.isPaused ? resumeChannel(channel.id) : pauseChannel(channel.id),
    onSuccess: async () => {
      toast.success(channel.isPaused ? "Channel resumed" : "Channel paused");
      await invalidateChannels(queryClient, orgId, projectId);
    },
  });

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          togglePauseMutation.mutate();
        }}
        loading={togglePauseMutation.isPending}
      >
        {!togglePauseMutation.isPending &&
          (channel.isPaused ? (
            <PlayIcon weight="bold" data-icon="inline-start" />
          ) : (
            <PauseIcon weight="bold" data-icon="inline-start" />
          ))}
        {channel.isPaused ? "Resume" : "Pause"}
      </Button>
      {channel.isBuiltin ? null : (
        <DeleteChannelDialog channel={channel} orgId={orgId} projectId={projectId} />
      )}
    </>
  );
};

const ChannelDetailSkeleton = () => (
  <>
    <DetailHeader title="Channel" />
    <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <DetailCardSkeleton rows={3} columns={2} />
      <DetailCardSkeleton rows={3} columns={1} />
    </div>
  </>
);

const ChannelDetailBody = ({
  channel,
  orgId,
  projectId,
  projectSlug,
}: {
  channel: Channel;
  orgId: string;
  projectId: string;
  projectSlug: string;
}) => {
  // Compatible builds are filtered + counted server-side (exact total, not a
  // newest-N scan); the matrix only decorates the rows with update-count badges
  // and supplies the missing-runtime warnings.
  const [{ data: compatibilityData }, { data: compatibleBuildsPage }, { data: updatesPage }] =
    useSuspenseQueries({
      queries: [
        buildCompatibilityMatrixQueryOptions(orgId, projectId),
        channelCompatibleBuildsQueryOptions(orgId, projectId, channel.id, {
          limit: VISIBLE_BUILD_LIMIT,
        }),
        // The channel serves whatever lands on its branch, so the branch's
        // newest updates are the channel's payload.
        updatesQueryOptions(orgId, projectId, {
          page: 1,
          limit: VISIBLE_UPDATE_LIMIT,
          branchId: [channel.branchId],
          sort: "-createdAt",
        }),
      ],
    });

  const compatibleBuilds = toCompatibleBuildEntries(
    compatibleBuildsPage.items,
    compatibilityData,
    channel.id,
  );
  const missingRuntimeVersions = getMissingRuntimeVersionsForChannel(
    compatibilityData.missingRuntimeVersions,
    channel.id,
  );

  return (
    <>
      <DetailHeader
        title={channel.name}
        badges={
          <>
            {channel.isBuiltin ? (
              <Badge variant="outline" className="text-kumo-subtle">
                Built-in
              </Badge>
            ) : null}
            {/* Paused / rolling out / live, in the same words the channels list
                uses — a card of its own only restated the button beside it. */}
            <span className="text-base font-normal">
              <ChannelStatusBadge channel={channel} />
            </span>
          </>
        }
        meta={
          <>
            <CopyableId value={channel.id} label="Channel ID" />
            <span className="flex items-center gap-1.5">
              <GitBranchIcon weight="bold" className="size-3.5" />
              {channel.branchName ?? channel.branchId.slice(0, 8)}
            </span>
            <span>
              Created <RelativeTime value={channel.createdAt} />
            </span>
          </>
        }
        actions={<ChannelHeaderActions channel={channel} orgId={orgId} projectId={projectId} />}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-4">
          <ChannelRolloutCard channel={channel} orgId={orgId} projectId={projectId} />
          <ChannelUpdatesCard
            projectSlug={projectSlug}
            branchId={channel.branchId}
            updates={updatesPage.items}
            totalCount={updatesPage.total}
          />
        </div>
        <ChannelBuildsCard
          projectSlug={projectSlug}
          compatibleBuilds={compatibleBuilds}
          totalCount={compatibleBuildsPage.total}
          missingRuntimeVersions={missingRuntimeVersions}
        />
      </div>
    </>
  );
};

const ChannelDetailContent = () => {
  const { channelId } = Route.useParams();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  // Non-suspense: an unknown channel id 404s on the get endpoint, and that
  // should render the in-page not-found state below instead of bubbling to
  // the route error boundary. The body's compatible-builds query (which would
  // 404 the same way) only mounts once the channel resolved successfully.
  const {
    data: channel,
    error: channelError,
    refetch,
  } = useQuery(channelQueryOptions(orgId, projectId, channelId));

  if (channelError) {
    return getTypedApiError(channelError)?._tag === "NotFound" ? (
      <>
        <DetailHeader title="Channel details" />
        <ChannelNotFoundState projectSlug={project.slug} />
      </>
    ) : (
      <QueryErrorState error={channelError} onRetry={refetch} />
    );
  }

  if (!channel) {
    return <ChannelDetailSkeleton />;
  }

  if (channel.projectId !== projectId) {
    return (
      <>
        <DetailHeader title="Channel details" />
        <ChannelNotFoundState projectSlug={project.slug} />
      </>
    );
  }

  return (
    <ChannelDetailBody
      channel={channel}
      orgId={orgId}
      projectId={projectId}
      projectSlug={project.slug}
    />
  );
};

const ChannelDetailPage = () => (
  <div className="flex w-full flex-col gap-4">
    <Suspense fallback={<ChannelDetailSkeleton />}>
      <ChannelDetailContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/channels/$channelId")({
  component: ChannelDetailPage,
});
