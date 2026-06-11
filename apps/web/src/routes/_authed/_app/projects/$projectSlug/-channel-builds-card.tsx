import { Badge } from "@better-update/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Link } from "@tanstack/react-router";

import type { MissingRuntimeVersionBuild } from "@better-update/api";

import { DistributionBadge, PlatformBadge } from "../../../../../components/attribute-badges";
import { formatDateTime } from "../../../../../lib/format-date";
import { MissingMatchingBuilds } from "./-channel-compatibility";

import type { CompatibleBuildEntry } from "./-channel-compatibility-helpers";
import type { SyntheticBuildChannel } from "./-compatibility-join";

const UpdateCountBadge = ({ status }: { status: SyntheticBuildChannel }) => {
  if (status.isPaused) {
    return <Badge variant="outline">Paused</Badge>;
  }

  if (status.updateCount > 0) {
    return <Badge variant="default">✓ {status.updateCount} updates</Badge>;
  }

  return <Badge variant="secondary">✗ no updates</Badge>;
};

const CompatibleBuildRow = ({
  projectSlug,
  entry: { build, status },
}: {
  projectSlug: string;
  entry: CompatibleBuildEntry;
}) => (
  <div className="flex flex-col gap-2 rounded-2xl border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/projects/$projectSlug/builds/$buildId"
          params={{ projectSlug, buildId: build.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
        </Link>
        <PlatformBadge platform={build.platform} />
        <DistributionBadge distribution={build.distribution} />
        {build.runtimeVersion ? (
          <span className="text-muted-foreground text-sm">v{build.runtimeVersion}</span>
        ) : (
          <Badge variant="warning">Missing runtime version</Badge>
        )}
      </div>
      <UpdateCountBadge status={status} />
    </div>
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {build.appVersion && <span>App {build.appVersion}</span>}
      {build.buildNumber && <span>#{build.buildNumber}</span>}
      <span>{formatDateTime(build.createdAt)}</span>
      {status.latestUpdateMessage && <span>latest {status.latestUpdateMessage}</span>}
    </div>
  </div>
);

export const ChannelBuildsCard = ({
  projectSlug,
  compatibleBuilds,
  missingRuntimeVersions,
}: {
  projectSlug: string;
  compatibleBuilds: readonly CompatibleBuildEntry[];
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Compatible builds</CardTitle>
      <CardDescription>
        Builds whose runtime version can install the updates served by this channel.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {compatibleBuilds.length > 0 ? (
        compatibleBuilds.map((entry) => (
          <CompatibleBuildRow
            key={`${entry.status.channelId}:${entry.build.id}`}
            projectSlug={projectSlug}
            entry={entry}
          />
        ))
      ) : (
        <p className="text-muted-foreground text-sm">
          No builds have been uploaded for this project yet.
        </p>
      )}
      <MissingMatchingBuilds missingRuntimeVersions={missingRuntimeVersions} />
    </CardContent>
  </Card>
);
