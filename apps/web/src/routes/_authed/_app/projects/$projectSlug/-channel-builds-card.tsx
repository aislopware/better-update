import { Badge } from "@better-update/ui/components/badge";
import { cn } from "@better-update/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import type { MissingRuntimeVersionBuild } from "@better-update/api";

import {
  DistributionIndicator,
  PlatformIndicator,
} from "../../../../../components/attribute-badges";
import { ListPanel, ListPanelFooter, ListPanelHeader } from "../../../../../lib/data-table";
import { pluralize } from "../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../lib/relative-time";
import { ROW_LINK_DIVIDED } from "../../../../../lib/row-link";
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

// The whole row goes to the build, not just the words in its title: a build is
// somewhere you go, and a link the width of a message is a target you have to
// aim at.
const CompatibleBuildRow = ({
  projectSlug,
  entry: { build, status },
}: {
  projectSlug: string;
  entry: CompatibleBuildEntry;
}) => (
  <Link
    to="/projects/$projectSlug/builds/$buildId"
    params={{ projectSlug, buildId: build.id }}
    className={cn(ROW_LINK_DIVIDED, "group/row flex items-start justify-between gap-3 px-4 py-3")}
  >
    <span className="flex min-w-0 flex-col gap-1">
      <span className="truncate font-medium">
        {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
      </span>
      <span className="text-kumo-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <PlatformIndicator platform={build.platform} className="gap-1" />
        <DistributionIndicator distribution={build.distribution} className="gap-1" />
        {build.runtimeVersion ? (
          <span className="font-mono">v{build.runtimeVersion}</span>
        ) : (
          <Badge variant="warning">Missing runtime version</Badge>
        )}
        {build.appVersion && <span className="font-mono">App {build.appVersion}</span>}
        <RelativeTime value={build.createdAt} />
      </span>
    </span>
    <span className="flex shrink-0 items-center gap-2">
      <UpdateCountStatus status={status} />
      <CaretRightIcon
        aria-hidden
        weight="bold"
        className="text-kumo-subtle size-4 opacity-0 transition-opacity duration-(--duration-quick) group-focus-within/row:opacity-100 group-hover/row:opacity-100"
      />
    </span>
  </Link>
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
    // The description under the title used to define the title — "builds whose
    // runtime version can install the updates served by this channel" — and
    // carry the total inside the sentence. The total is what a panel's closing
    // bar is for, so it says how much of the set is on screen there instead.
    <ListPanel>
      <ListPanelHeader title="Compatible builds" />
      {missingRuntimeVersions.length > 0 ? (
        <div className="border-kumo-line border-b p-4">
          <MissingMatchingBuilds missingRuntimeVersions={missingRuntimeVersions} />
        </div>
      ) : null}
      {visible.length > 0 ? (
        visible.map((entry) => (
          <CompatibleBuildRow
            key={`${entry.status.channelId}:${entry.build.id}`}
            projectSlug={projectSlug}
            entry={entry}
          />
        ))
      ) : (
        <ListPanelFooter>
          <span className="text-kumo-subtle text-sm">
            No uploaded builds can install this channel&apos;s updates yet.
          </span>
        </ListPanelFooter>
      )}
      {visible.length > 0 ? (
        <ListPanelFooter>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-kumo-subtle text-sm tabular-nums">
              Showing {visible.length} of {totalCount} {pluralize(totalCount, "build")}
            </span>
            {hiddenCount > 0 ? (
              <Link
                to="/projects/$projectSlug/builds"
                params={{ projectSlug }}
                className="text-kumo-subtle hover:text-kumo-default text-sm"
              >
                View all builds →
              </Link>
            ) : null}
          </div>
        </ListPanelFooter>
      ) : null}
    </ListPanel>
  );
};
