import {
  branchesQueryOptions,
  buildCompatibilityMatrixQueryOptions,
  channelsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ChannelCard } from "../-channel-card";
import {
  getCompatibleBuildsForChannel,
  getMissingRuntimeVersionsForChannel,
} from "../-channel-compatibility-helpers";
import { ProjectSubpageHeader } from "../-project-subpage-header";

const ChannelNotFoundState = ({ projectSlug }: { projectSlug: string }) => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col gap-3 py-10">
      <div className="text-lg font-medium">Channel not found in this project</div>
      <p className="text-muted-foreground text-sm">
        The requested channel does not belong to this project or was removed.
      </p>
      <div>
        <Link
          to="/projects/$projectSlug"
          params={{ projectSlug }}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          Back to project
        </Link>
      </div>
    </CardContent>
  </Card>
);

const ChannelSummaryCards = ({
  linkedBranchName,
  compatibleBuildsCount,
  missingBuildCount,
  isPaused,
  rolloutActive,
}: {
  linkedBranchName: string;
  compatibleBuildsCount: number;
  missingBuildCount: number;
  isPaused: boolean;
  rolloutActive: boolean;
}) => (
  <div className="grid gap-4 sm:grid-cols-3">
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Linked branch</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-medium">{linkedBranchName}</div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Channel state</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Badge variant={isPaused ? "outline" : "secondary"}>{isPaused ? "Paused" : "Live"}</Badge>
        {rolloutActive ? <Badge variant="secondary">Rollout active</Badge> : null}
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Build coverage</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <div className="font-medium">{compatibleBuildsCount} compatible builds</div>
        <div className="text-muted-foreground mt-1">
          {missingBuildCount} runtime versions currently missing builds
        </div>
      </CardContent>
    </Card>
  </div>
);

const CompatibleBuildLinksCard = ({
  projectSlug,
  compatibleBuilds,
}: {
  projectSlug: string;
  compatibleBuilds: ReturnType<typeof getCompatibleBuildsForChannel>;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Open compatible builds</CardTitle>
      <CardDescription>
        Jump directly to a build detail page for install and artifact actions.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {compatibleBuilds.length > 0 ? (
        <div className="flex flex-col gap-3">
          {compatibleBuilds.map(({ build, status }) => (
            <div
              key={`${status.channelId}:${build.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
                </span>
                <Badge variant="outline">{build.platform}</Badge>
                {build.runtimeVersion ? (
                  <span className="text-muted-foreground text-sm">v{build.runtimeVersion}</span>
                ) : (
                  <Badge variant="secondary">Missing runtimeVersion</Badge>
                )}
              </div>
              <Link
                to="/projects/$projectSlug/builds/$buildId"
                params={{ projectSlug, buildId: build.id }}
                className="text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                Open build
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No compatible builds are currently available for this channel.
        </p>
      )}
    </CardContent>
  </Card>
);

const ChannelDetailPage = () => {
  const { channelId } = Route.useParams();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;
  const { data: channelsData } = useSuspenseQuery(channelsQueryOptions(orgId, projectId));
  const { data: branchesData } = useSuspenseQuery(branchesQueryOptions(orgId, projectId));
  const { data: compatibilityData } = useSuspenseQuery(
    buildCompatibilityMatrixQueryOptions(orgId, projectId),
  );

  const channel = channelsData.items.find((item) => item.id === channelId);

  if (!channel) {
    return (
      <div className="flex w-full flex-col gap-4">
        <ProjectSubpageHeader title="Channel details" />
        <ChannelNotFoundState projectSlug={project.slug} />
      </div>
    );
  }

  const linkedBranch = branchesData.items.find((branch) => branch.id === channel.branchId);
  const compatibleBuilds = getCompatibleBuildsForChannel(compatibilityData.rows, channel.id);
  const missingRuntimeVersions = getMissingRuntimeVersionsForChannel(
    compatibilityData.missingRuntimeVersions,
    channel.id,
  );
  const rolloutActive = compatibleBuilds.some(({ status }) => status.rolloutActive);

  return (
    <div className="flex w-full flex-col gap-4">
      <ProjectSubpageHeader title={channel.name} />

      <ChannelSummaryCards
        linkedBranchName={linkedBranch?.name ?? channel.branchId}
        compatibleBuildsCount={compatibleBuilds.length}
        missingBuildCount={missingRuntimeVersions.length}
        isPaused={channel.isPaused}
        rolloutActive={rolloutActive}
      />

      <ChannelCard
        channel={channel}
        orgId={orgId}
        projectId={projectId}
        projectSlug={project.slug}
        branches={branchesData.items}
        compatibleBuilds={compatibleBuilds}
        missingRuntimeVersions={missingRuntimeVersions}
        showDetailsLink={false}
      />

      <CompatibleBuildLinksCard projectSlug={project.slug} compatibleBuilds={compatibleBuilds} />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/channels/$channelId")({
  loader: async ({ context }) => {
    const orgId = context.activeOrg.id;
    const projectId = context.project.id;
    await Promise.all([
      context.queryClient.ensureQueryData(channelsQueryOptions(orgId, projectId)),
      context.queryClient.ensureQueryData(branchesQueryOptions(orgId, projectId)),
      context.queryClient.ensureQueryData(buildCompatibilityMatrixQueryOptions(orgId, projectId)),
    ]);
  },
  component: ChannelDetailPage,
});
