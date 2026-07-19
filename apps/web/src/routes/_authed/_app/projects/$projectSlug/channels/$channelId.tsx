import { getTypedApiError } from "@better-update/api-client";
import {
  buildCompatibilityMatrixQueryOptions,
  channelCompatibleBuildsQueryOptions,
  channelQueryOptions,
  pauseChannel,
  resumeChannel,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useQuery, useQueryClient, useSuspenseQueries } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { GitBranchIcon, PauseIcon, PlayIcon, RadioTowerIcon } from "lucide-react";
import { Suspense } from "react";

import type { Channel } from "@better-update/api";

import { ChannelBuildsCard, VISIBLE_BUILD_LIMIT } from "../-channel-builds-card";
import {
  getMissingRuntimeVersionsForChannel,
  toCompatibleBuildEntries,
} from "../-channel-compatibility-helpers";
import { ChannelRolloutCard } from "../-channel-rollout-card";
import { parseRolloutState } from "../-channel-rollout-state";
import { ChannelStatusBadge } from "../-channel-status-badge";
import { DeleteChannelDialog } from "../-delete-channel-dialog";
import { invalidateChannels } from "../-update-helpers";
import { DetailHeader, DetailNotFound } from "../../../../../../components/detail-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { DetailCardSkeleton, SummaryCardsSkeleton } from "../../../../../../components/skeletons";
import { StatCard } from "../../../../../../components/stat-card";
import { CopyableId } from "../../../../../../lib/copy-button";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { useApiMutation } from "../../../../../../lib/use-api-mutation";

const ChannelNotFoundState = ({ projectSlug }: { projectSlug: string }) => (
  <DetailNotFound
    icon={<RadioTowerIcon strokeWidth={1.5} />}
    title="Channel not found in this project"
    description="The requested channel does not belong to this project or was removed."
    backLink={<Link to="/projects/$projectSlug" params={{ projectSlug }} />}
    backLabel="Back to project"
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
        variant="outline"
        disabled={togglePauseMutation.isPending}
        onClick={() => {
          togglePauseMutation.mutate();
        }}
      >
        {togglePauseMutation.isPending && <Spinner data-icon="inline-start" />}
        {!togglePauseMutation.isPending &&
          (channel.isPaused ? (
            <PlayIcon strokeWidth={2} data-icon="inline-start" />
          ) : (
            <PauseIcon strokeWidth={2} data-icon="inline-start" />
          ))}
        {channel.isPaused ? "Resume" : "Pause"}
      </Button>
      {channel.isBuiltin ? null : (
        <DeleteChannelDialog channel={channel} orgId={orgId} projectId={projectId} />
      )}
    </>
  );
};

const ChannelSummaryCards = ({
  channel,
  compatibleBuildsCount,
  missingBuildCount,
}: {
  channel: Channel;
  compatibleBuildsCount: number;
  missingBuildCount: number;
}) => {
  const rolloutState = channel.branchMappingJson
    ? parseRolloutState(channel.branchMappingJson)
    : null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Linked branch">
        {channel.branchName ? (
          <div className="flex items-center gap-2 font-medium">
            <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-4" />
            {channel.branchName}
          </div>
        ) : (
          <CopyableId value={channel.branchId} label="Branch ID" />
        )}
      </StatCard>
      <StatCard label="Channel state">
        <div className="flex flex-col items-start gap-2">
          <ChannelStatusBadge channel={channel} />
          {rolloutState ? (
            <span className="text-muted-foreground text-sm tabular-nums">
              {rolloutState.percentage}% →{" "}
              {channel.rolloutTargetBranchName ?? rolloutState.targetBranchId.slice(0, 8)}
            </span>
          ) : null}
        </div>
      </StatCard>
      <StatCard
        label="Compatible builds"
        value={compatibleBuildsCount}
        footer={
          missingBuildCount > 0
            ? `${missingBuildCount} runtime ${pluralize(missingBuildCount, "version")} currently missing builds`
            : undefined
        }
      />
    </div>
  );
};

const ChannelDetailSkeleton = () => (
  <>
    <DetailHeader title="Channel" />
    <SummaryCardsSkeleton count={4} />
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
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
  const [{ data: compatibilityData }, { data: compatibleBuildsPage }] = useSuspenseQueries({
    queries: [
      buildCompatibilityMatrixQueryOptions(orgId, projectId),
      channelCompatibleBuildsQueryOptions(orgId, projectId, channel.id, {
        limit: VISIBLE_BUILD_LIMIT,
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
          channel.isBuiltin ? (
            <Badge variant="outline" className="text-muted-foreground">
              Built-in
            </Badge>
          ) : null
        }
        meta={
          <>
            <CopyableId value={channel.id} label="Channel ID" />
            <span>
              Created <RelativeTime value={channel.createdAt} />
            </span>
          </>
        }
        actions={<ChannelHeaderActions channel={channel} orgId={orgId} projectId={projectId} />}
      />

      <ChannelSummaryCards
        channel={channel}
        compatibleBuildsCount={compatibleBuildsPage.total}
        missingBuildCount={missingRuntimeVersions.length}
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <ChannelRolloutCard channel={channel} orgId={orgId} projectId={projectId} />
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
