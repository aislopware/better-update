import { Badge } from "@better-update/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";
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

// Keep the card glanceable — a busy project can match dozens of builds. The
// page fetches exactly this many rows; `totalCount` carries the exact
// server-side total for the "N more" link.
export const VISIBLE_BUILD_LIMIT = 6;

const UpdateCountStatus = ({ status }: { status: SyntheticBuildChannel }) => {
  // Whether the channel is paused is a fact about the channel, said once in its
  // header; repeating it down every row hid the one thing that differs between
  // them — how many updates each build can be served. Being served is the
  // ordinary case and reads as a count, not as a green badge on every row; a
  // build the channel has nothing for is the quiet exception.
  if (status.updateCount > 0) {
    return (
      <span className="shrink-0 text-xs tabular-nums">
        {status.updateCount} {pluralize(status.updateCount, "update")}
      </span>
    );
  }

  return <span className="text-kumo-subtle shrink-0 text-xs">No updates</span>;
};

const CompatibleBuildRow = ({
  projectSlug,
  entry: { build, status },
}: {
  projectSlug: string;
  entry: CompatibleBuildEntry;
}) => (
  <div className="border-kumo-line/60 flex items-start justify-between gap-3 border-b py-2.5 first:pt-0 last:border-0 last:pb-0">
    <div className="flex min-w-0 flex-col gap-1">
      <Link
        to="/projects/$projectSlug/builds/$buildId"
        params={{ projectSlug, buildId: build.id }}
        className="truncate font-medium underline-offset-4 hover:underline"
      >
        {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
      </Link>
      <div className="text-kumo-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
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
  totalCount,
  missingRuntimeVersions,
}: {
  projectSlug: string;
  compatibleBuilds: readonly CompatibleBuildEntry[];
  totalCount: number;
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
}) => {
  const visible = compatibleBuilds.slice(0, VISIBLE_BUILD_LIMIT);
  const hiddenCount = Math.max(0, totalCount - visible.length);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compatible builds</CardTitle>
        {/* The count leads the sentence that says what it counts, which is what
            a card of its own used to do with a bare number. */}
        <CardDescription>
          {totalCount} {pluralize(totalCount, "build")} whose runtime version can install the
          updates served by this channel.
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
          <p className="text-kumo-subtle text-sm">
            No uploaded builds can install this channel&apos;s updates yet.
          </p>
        )}
        {hiddenCount > 0 && (
          <Link
            to="/projects/$projectSlug/builds"
            params={{ projectSlug }}
            className="text-kumo-subtle hover:text-kumo-default text-sm"
          >
            {hiddenCount} more compatible {pluralize(hiddenCount, "build")} — view all builds →
          </Link>
        )}
        <MissingMatchingBuilds missingRuntimeVersions={missingRuntimeVersions} />
      </CardContent>
    </Card>
  );
};
