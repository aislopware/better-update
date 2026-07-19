import {
  auditLogsInfiniteQueryOptions,
  projectsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
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
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { useInfiniteQuery, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { Suspense } from "react";

import { PageHeader } from "../../../components/page-header";
import { SummaryCardsSkeleton } from "../../../components/skeletons";
import { StatCard, StatCardGrid } from "../../../components/stat-card";
import { RelativeTime } from "../../../lib/relative-time";
import { invitationsQueryOptions, membersQueryOptions, meQueryOptions } from "../../../queries/org";
import { actionLabel } from "./-audit-log-view";

const ACTIVITY_LIMIT = 8;

interface ActivityEntry {
  readonly id: string;
  readonly action: string;
  readonly actorEmail: string;
  readonly source: string;
  readonly createdAt: string;
}

// Compact sibling of the audit-log table row: action + actor on the left,
// relative time on the right.
const ActivityRow = ({ entry }: { entry: ActivityEntry }) => (
  <div className="flex items-center justify-between gap-3 px-2 py-2.5">
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm font-medium" title={entry.action}>
        {actionLabel(entry.action)}
      </span>
      <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
        <span className="truncate">{entry.actorEmail}</span>
        {entry.source === "robot" ? <Badge variant="secondary">Robot</Badge> : null}
      </span>
    </span>
    <span className="text-muted-foreground shrink-0 text-xs">
      <RelativeTime value={entry.createdAt} />
    </span>
  </div>
);

const activitySkeleton = (
  <div className="skeleton-appear flex flex-col gap-1">
    {[0, 1, 2, 3].map((index) => (
      <div key={index} className="flex items-center justify-between gap-3 px-2 py-2.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-48 rounded" />
          <Skeleton className="h-3 w-32 rounded" />
        </div>
        <Skeleton className="h-3 w-16 rounded" />
      </div>
    ))}
  </div>
);

const ActivityBody = ({
  isLoading,
  items,
}: {
  isLoading: boolean;
  items: readonly ActivityEntry[];
}) => {
  if (isLoading) {
    return activitySkeleton;
  }
  if (items.length === 0) {
    return <p className="text-muted-foreground px-2 py-4 text-sm">No activity recorded yet.</p>;
  }
  return (
    <div className="divide-border/60 flex flex-col divide-y">
      {items.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
};

const RecentActivityCard = ({ orgId }: { orgId: string }) => {
  // Only the first page of the shared audit-log infinite query — the "View
  // audit log" link is the path to the full, filterable history.
  const { data, isLoading } = useInfiniteQuery(
    auditLogsInfiniteQueryOptions(orgId, { limit: ACTIVITY_LIMIT }),
  );
  const items = data?.pages[0]?.items ?? [];
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardAction>
          <Link
            to="/audit-log"
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
          >
            View audit log →
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2">
        <ActivityBody isLoading={isLoading} items={items} />
      </CardContent>
    </Card>
  );
};

const FirstProjectCard = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>Create your first project</EmptyTitle>
        <EmptyDescription>
          Projects group the branches, channels, and updates for one app.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/projects" />}>Go to projects</Button>
      </EmptyContent>
    </Empty>
  </Card>
);

const OverviewContent = ({ orgId }: { orgId: string }) => {
  const [meQ, projectsQ, membersQ] = useSuspenseQueries({
    queries: [
      meQueryOptions(),
      // One row is enough: `total` is the KPI and the top item (sorted by
      // -lastActivityAt) names where the latest activity happened.
      projectsQueryOptions(orgId, { limit: 1, sort: "-lastActivityAt", status: "active" }),
      membersQueryOptions(orgId),
    ],
  });
  const me = meQ.data;
  const [latest] = projectsQ.data.items;
  // The invitations list is IAM-gated; only fetch when the actor holds the
  // invite capability (same gate the Members page uses).
  const invitesQ = useQuery({ ...invitationsQueryOptions(orgId), enabled: me.canInviteMembers });
  const pendingInvites = invitesQ.data?.filter((invite) => invite.status === "pending").length;

  return (
    <div className="flex flex-col gap-6">
      <StatCardGrid>
        <StatCard label="Active projects" value={projectsQ.data.total} />
        <StatCard label="Members" value={membersQ.data.length} />
        {me.canInviteMembers ? (
          <StatCard
            label="Pending invites"
            value={pendingInvites ?? <Skeleton className="h-8 w-12 rounded" />}
          />
        ) : null}
        <StatCard
          label="Last activity"
          value={<RelativeTime value={latest?.lastActivityAt} />}
          footer={latest ? <span className="truncate">in {latest.name}</span> : undefined}
        />
      </StatCardGrid>
      {projectsQ.data.total === 0 ? <FirstProjectCard /> : null}
      {me.canViewAuditLog ? <RecentActivityCard orgId={orgId} /> : null}
    </div>
  );
};

const OrgOverview = () => {
  const { activeOrg } = Route.useRouteContext();
  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title="Overview" description={`What's happening across ${activeOrg.name}.`} />
      <Suspense fallback={<SummaryCardsSkeleton count={4} />}>
        <OverviewContent orgId={activeOrg.id} />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/")({
  component: OrgOverview,
});
