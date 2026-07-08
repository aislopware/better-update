import {
  branchesQueryOptions,
  buildsQueryOptions,
  channelsQueryOptions,
  runtimesQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GitBranchIcon, RocketIcon } from "lucide-react";

import type { Channel } from "@better-update/api";
import type { BranchItem } from "@better-update/api-client/react";
import type { ReactElement, ReactNode } from "react";

import { PlatformIndicator } from "../../../../../components/attribute-badges";
import { CliCommandBlock } from "../../../../../components/cli-command-block";
import { StatCard, StatCardGrid } from "../../../../../components/stat-card";
import { RelativeTime } from "../../../../../lib/relative-time";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../queries/constants";
import { ChannelStatusBadge } from "./-channel-status-badge";

const RECENT_LIMIT = 5;

interface OverviewScope {
  readonly orgId: string;
  readonly projectId: string;
  readonly projectSlug: string;
}

/** Copy-paste CLI onboarding for a project with no builds or updates yet. */
const FIRST_PUBLISH_COMMANDS = [
  "better-update init",
  'better-update update publish --branch main --message "First update"',
] as const;

const FirstPublishCard = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RocketIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>Publish your first update</EmptyTitle>
        <EmptyDescription>
          Link this project from your app repo, then publish — channels, branches, and analytics
          light up from the first update.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <CliCommandBlock commands={FIRST_PUBLISH_COMMANDS} />
      </EmptyContent>
    </Empty>
  </Card>
);

/** One channel row in the "Live now" hero: name → branch → latest update → state. */
const LiveNowRow = ({
  scope,
  channel,
  branches,
}: {
  scope: OverviewScope;
  channel: Channel;
  branches: readonly BranchItem[];
}) => {
  const { data } = useSuspenseQuery(
    updatesQueryOptions(scope.orgId, scope.projectId, {
      branchId: [channel.branchId],
      limit: 1,
      sort: "-createdAt",
    }),
  );
  const [latest] = data.items;
  const branchName = branches.find((branch) => branch.id === channel.branchId)?.name;

  return (
    <Link
      to="/projects/$projectSlug/channels/$channelId"
      params={{ projectSlug: scope.projectSlug, channelId: channel.id }}
      className="hover:bg-muted/50 grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 transition-colors"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{channel.name}</span>
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <GitBranchIcon strokeWidth={2} className="size-3 shrink-0" />
          <span className="truncate">{branchName ?? channel.branchId.slice(0, 8)}</span>
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {latest ? (
          <>
            <span className="truncate text-sm">{latest.message || "Untitled update"}</span>
            <span className="text-muted-foreground text-xs">
              <RelativeTime value={latest.createdAt} />
            </span>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">No updates on this branch yet</span>
        )}
      </span>
      <ChannelStatusBadge channel={channel} branches={branches} />
    </Link>
  );
};

const LiveNowCard = ({
  scope,
  channels,
  branches,
}: {
  scope: OverviewScope;
  channels: readonly Channel[];
  branches: readonly BranchItem[];
}) => (
  <Card className="gap-4">
    <CardHeader>
      <CardTitle>Live now</CardTitle>
      <CardDescription>What each channel serves right now.</CardDescription>
      <CardAction>
        <Link
          to="/projects/$projectSlug/channels"
          params={{ projectSlug: scope.projectSlug }}
          className="text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          View channels →
        </Link>
      </CardAction>
    </CardHeader>
    <CardContent className="px-2">
      <div className="divide-border/60 flex flex-col divide-y">
        {channels.map((channel) => (
          <LiveNowRow key={channel.id} scope={scope} channel={channel} branches={branches} />
        ))}
      </div>
    </CardContent>
  </Card>
);

interface RecentEntry {
  readonly key: string;
  readonly title: string;
  readonly platform: "ios" | "android";
  readonly meta: string;
  readonly createdAt: string;
  readonly detailId: string;
}

const RecentListCard = ({
  title,
  viewAllLabel,
  entries,
  emptyMessage,
  renderLink,
}: {
  title: string;
  viewAllLabel: ReactNode;
  entries: readonly RecentEntry[];
  emptyMessage: string;
  renderLink: (entry: RecentEntry, children: ReactNode) => ReactElement;
}) => (
  <Card className="gap-4">
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardAction>{viewAllLabel}</CardAction>
    </CardHeader>
    <CardContent className="px-2">
      {entries.length === 0 ? (
        <p className="text-muted-foreground px-2 py-4 text-sm">{emptyMessage}</p>
      ) : (
        <div className="divide-border/60 flex flex-col divide-y">
          {entries.map((entry) =>
            renderLink(
              entry,
              <>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{entry.title}</span>
                  <span className="text-muted-foreground flex items-center gap-2 text-xs">
                    <PlatformIndicator platform={entry.platform} className="gap-1" />
                    <span className="truncate font-mono">{entry.meta}</span>
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  <RelativeTime value={entry.createdAt} />
                </span>
              </>,
            ),
          )}
        </div>
      )}
    </CardContent>
  </Card>
);

const viewAllLink = (scope: OverviewScope, to: "updates" | "builds") => (
  <Link
    to={to === "updates" ? "/projects/$projectSlug/updates" : "/projects/$projectSlug/builds"}
    params={{ projectSlug: scope.projectSlug }}
    className="text-muted-foreground hover:text-foreground text-sm transition-colors"
  >
    View all →
  </Link>
);

const ROW_LINK_CLASS =
  "hover:bg-muted/50 flex items-center justify-between gap-3 rounded-sm px-2 py-2.5 transition-colors";

export const OverviewContent = ({ scope }: { scope: OverviewScope }) => {
  const { orgId, projectId } = scope;
  const [channelsQ, branchesQ, updatesQ, buildsQ, runtimesQ] = useSuspenseQueries({
    queries: [
      channelsQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT, sort: "name" }),
      branchesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
      updatesQueryOptions(orgId, projectId, { limit: RECENT_LIMIT, sort: "-createdAt" }),
      buildsQueryOptions(orgId, projectId, { limit: RECENT_LIMIT, sort: "-createdAt" }),
      runtimesQueryOptions(orgId, projectId, { limit: 1 }),
    ],
  });

  const channels = channelsQ.data.items;
  const branches = branchesQ.data.items;
  const updates = updatesQ.data;
  const builds = buildsQ.data;

  const isFirstRun = updates.total === 0 && builds.total === 0;

  const branchName = (branchId: string) =>
    branches.find((branch) => branch.id === branchId)?.name ?? branchId.slice(0, 8);

  const updateEntries: readonly RecentEntry[] = updates.items.map((update) => ({
    key: update.id,
    title: update.message || "Untitled update",
    platform: update.platform,
    meta: branchName(update.branchId),
    createdAt: update.createdAt,
    detailId: update.id,
  }));

  const buildEntries: readonly RecentEntry[] = builds.items.map((build) => ({
    key: build.id,
    title: (build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`,
    platform: build.platform,
    meta: build.appVersion ? `App ${build.appVersion}` : `v${build.runtimeVersion ?? "?"}`,
    createdAt: build.createdAt,
    detailId: build.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <StatCardGrid>
        <StatCard label="Updates" value={updates.total} />
        <StatCard label="Builds" value={builds.total} />
        <StatCard label="Channels" value={channelsQ.data.total} />
        <StatCard label="Runtimes" value={runtimesQ.data.total} />
      </StatCardGrid>

      {isFirstRun ? (
        <FirstPublishCard />
      ) : (
        <>
          {channels.length > 0 && (
            <LiveNowCard scope={scope} channels={channels} branches={branches} />
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <RecentListCard
              title="Recent updates"
              viewAllLabel={viewAllLink(scope, "updates")}
              entries={updateEntries}
              emptyMessage="No updates published yet."
              renderLink={(entry, children) => (
                <Link
                  key={entry.key}
                  to="/projects/$projectSlug/updates/$updateId"
                  params={{ projectSlug: scope.projectSlug, updateId: entry.detailId }}
                  className={ROW_LINK_CLASS}
                >
                  {children}
                </Link>
              )}
            />
            <RecentListCard
              title="Recent builds"
              viewAllLabel={viewAllLink(scope, "builds")}
              entries={buildEntries}
              emptyMessage="No builds uploaded yet."
              renderLink={(entry, children) => (
                <Link
                  key={entry.key}
                  to="/projects/$projectSlug/builds/$buildId"
                  params={{ projectSlug: scope.projectSlug, buildId: entry.detailId }}
                  className={ROW_LINK_CLASS}
                >
                  {children}
                </Link>
              )}
            />
          </div>
        </>
      )}
    </div>
  );
};
