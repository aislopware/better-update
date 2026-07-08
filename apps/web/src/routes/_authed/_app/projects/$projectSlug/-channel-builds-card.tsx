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

import {
  DistributionIndicator,
  PlatformIndicator,
} from "../../../../../components/attribute-badges";
import { formatDateTime } from "../../../../../lib/format-date";
import { pluralize } from "../../../../../lib/pluralize";
import { MissingMatchingBuilds } from "./-channel-compatibility";

import type { CompatibleBuildEntry } from "./-channel-compatibility-helpers";
import type { SyntheticBuildChannel } from "./-compatibility-join";

// Keep the card glanceable — a busy project can match dozens of builds.
const VISIBLE_BUILD_LIMIT = 6;

const UpdateCountStatus = ({ status }: { status: SyntheticBuildChannel }) => {
  if (status.isPaused) {
    return <Badge variant="outline">Paused</Badge>;
  }

  // Only builds that DO receive updates get color — "no updates" is the quiet default.
  if (status.updateCount > 0) {
    return (
      <Badge variant="success">
        {status.updateCount} {pluralize(status.updateCount, "update")}
      </Badge>
    );
  }

  return <span className="text-muted-foreground text-xs">No updates</span>;
};

const CompatibleBuildRow = ({
  projectSlug,
  entry: { build, status },
}: {
  projectSlug: string;
  entry: CompatibleBuildEntry;
}) => (
  <div className="border-border/60 flex items-start justify-between gap-3 border-b py-2.5 first:pt-0 last:border-0 last:pb-0">
    <div className="flex min-w-0 flex-col gap-1">
      <Link
        to="/projects/$projectSlug/builds/$buildId"
        params={{ projectSlug, buildId: build.id }}
        className="truncate font-medium underline-offset-4 hover:underline"
      >
        {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
      </Link>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <PlatformIndicator platform={build.platform} className="gap-1" />
        <DistributionIndicator distribution={build.distribution} className="gap-1" />
        {build.runtimeVersion ? (
          <span className="font-mono">v{build.runtimeVersion}</span>
        ) : (
          <Badge variant="warning">Missing runtime version</Badge>
        )}
        {build.appVersion && <span className="font-mono">App {build.appVersion}</span>}
        <span>{formatDateTime(build.createdAt)}</span>
      </div>
    </div>
    <UpdateCountStatus status={status} />
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
}) => {
  const visible = compatibleBuilds.slice(0, VISIBLE_BUILD_LIMIT);
  const hiddenCount = compatibleBuilds.length - visible.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compatible builds</CardTitle>
        <CardDescription>
          Builds whose runtime version can install the updates served by this channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {visible.length > 0 ? (
          <div className="flex flex-col">
            {visible.map((entry) => (
              <CompatibleBuildRow
                key={`${entry.status.channelId}:${entry.build.id}`}
                projectSlug={projectSlug}
                entry={entry}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No builds have been uploaded for this project yet.
          </p>
        )}
        {hiddenCount > 0 && (
          <Link
            to="/projects/$projectSlug/builds"
            params={{ projectSlug }}
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            {hiddenCount} more compatible {pluralize(hiddenCount, "build")} — view all builds →
          </Link>
        )}
        <MissingMatchingBuilds missingRuntimeVersions={missingRuntimeVersions} />
      </CardContent>
    </Card>
  );
};
