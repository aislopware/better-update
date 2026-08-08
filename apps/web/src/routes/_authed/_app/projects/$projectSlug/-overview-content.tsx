import {
  buildsQueryOptions,
  channelsQueryOptions,
  runtimesQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import { Empty } from "@better-update/ui/components/empty";
import { GitBranchIcon, RocketIcon } from "@phosphor-icons/react";
import { useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { Channel } from "@better-update/api";
import type { ReactElement, ReactNode } from "react";

import { PlatformIndicator } from "../../../../../components/attribute-badges";
import { CliCommandBlock } from "../../../../../components/cli-command-block";
import { ShippingActivityPanel } from "../../../../../components/shipping-activity";
import { ListPanel, ListPanelHeader } from "../../../../../lib/data-table";
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
  <Empty
    icon={<RocketIcon className="text-kumo-inactive size-10" />}
    title="Publish your first update"
    description="Link this project from your app repo, then publish — channels, branches, and analytics light up from the first update."
    contents={<CliCommandBlock commands={FIRST_PUBLISH_COMMANDS} />}
  />
);

/** One channel row in the "Live now" hero: name → branch → latest update → state. */
const LiveNowRow = ({ scope, channel }: { scope: OverviewScope; channel: Channel }) => {
  const { data } = useSuspenseQuery(
    updatesQueryOptions(scope.orgId, scope.projectId, {
      branchId: [channel.branchId],
      limit: 1,
      sort: "-createdAt",
    }),
  );
  const [latest] = data.items;

  return (
    <Link
      to="/projects/$projectSlug/channels/$channelId"
      params={{ projectSlug: scope.projectSlug, channelId: channel.id }}
      className="hover:bg-kumo-tint/50 grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-medium">{channel.name}</span>
        <span className="text-kumo-subtle flex items-center gap-1 text-xs">
          <GitBranchIcon weight="bold" className="size-3 shrink-0" />
          <span className="truncate">{channel.branchName ?? channel.branchId.slice(0, 8)}</span>
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        {latest ? (
          <>
            <span className="truncate text-sm">{latest.message || "Untitled update"}</span>
            <span className="text-kumo-subtle text-xs">
              <RelativeTime value={latest.createdAt} />
            </span>
          </>
        ) : (
          <span className="text-kumo-subtle text-sm">No updates on this branch yet</span>
        )}
      </span>
      <ChannelStatusBadge channel={channel} />
    </Link>
  );
};

const LiveNowCard = ({
  scope,
  channels,
}: {
  scope: OverviewScope;
  channels: readonly Channel[];
}) => (
  <ListPanel>
    <ListPanelHeader
      title="Live now"
      description="What each channel serves right now."
      actions={
        <Link
          to="/projects/$projectSlug/channels"
          params={{ projectSlug: scope.projectSlug }}
          className="text-kumo-subtle hover:text-kumo-default text-sm"
        >
          View channels →
        </Link>
      }
    />
    <div className="divide-kumo-line/60 flex flex-col divide-y">
      {channels.map((channel) => (
        <LiveNowRow key={channel.id} scope={scope} channel={channel} />
      ))}
    </div>
  </ListPanel>
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
  <ListPanel>
    <ListPanelHeader title={title} actions={viewAllLabel} />
    {entries.length === 0 ? (
      <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">{emptyMessage}</p>
    ) : (
      <div className="divide-kumo-line/60 flex flex-col divide-y">
        {entries.map((entry) =>
          renderLink(
            entry,
            <>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{entry.title}</span>
                <span className="text-kumo-subtle flex items-center gap-2 text-xs">
                  <PlatformIndicator platform={entry.platform} className="gap-1" />
                  <span className="truncate font-mono">{entry.meta}</span>
                </span>
              </span>
              <span className="text-kumo-subtle shrink-0 text-xs">
                <RelativeTime value={entry.createdAt} />
              </span>
            </>,
          ),
        )}
      </div>
    )}
  </ListPanel>
);

const viewAllLink = (scope: OverviewScope, to: "updates" | "builds") => (
  <Link
    to={to === "updates" ? "/projects/$projectSlug/updates" : "/projects/$projectSlug/builds"}
    params={{ projectSlug: scope.projectSlug }}
    className="text-kumo-subtle hover:text-kumo-default text-sm"
  >
    View all →
  </Link>
);

// Full-bleed inside the panel, like every other list row: the frame draws the
// edge, so a row that insets itself from it reads as a card within a card.
const ROW_LINK_CLASS = "hover:bg-kumo-tint/50 flex items-center justify-between gap-3 px-4 py-3";

export const OverviewContent = ({ scope }: { scope: OverviewScope }) => {
  const { orgId, projectId } = scope;
  const [channelsQ, updatesQ, buildsQ, runtimesQ] = useSuspenseQueries({
    queries: [
      channelsQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT, sort: "name" }),
      updatesQueryOptions(orgId, projectId, { limit: RECENT_LIMIT, sort: "-createdAt" }),
      buildsQueryOptions(orgId, projectId, { limit: RECENT_LIMIT, sort: "-createdAt" }),
      runtimesQueryOptions(orgId, projectId, { limit: 1 }),
    ],
  });

  const channels = channelsQ.data.items;
  const updates = updatesQ.data;
  const builds = buildsQ.data;

  const isFirstRun = updates.total === 0 && builds.total === 0;

  const updateEntries: readonly RecentEntry[] = updates.items.map((update) => ({
    key: update.id,
    title: update.message || "Untitled update",
    platform: update.platform,
    meta: update.branchName ?? update.branchId.slice(0, 8),
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
      {/* Lifetime counts close the panel rather than standing in the strip: how
          many channels a project has is shape, not activity, and "Updates, all
          time" printed in the same figures beside "Updates published" read as
          two answers to one question. */}
      <ShippingActivityPanel
        orgId={orgId}
        projectId={projectId}
        extras={[
          { label: "Updates, all time", value: updates.total },
          { label: "Builds, all time", value: builds.total },
          { label: "Channels", value: channelsQ.data.total },
          { label: "Runtimes", value: runtimesQ.data.total },
        ]}
      />

      {isFirstRun ? (
        <FirstPublishCard />
      ) : (
        <>
          {channels.length > 0 && <LiveNowCard scope={scope} channels={channels} />}
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
