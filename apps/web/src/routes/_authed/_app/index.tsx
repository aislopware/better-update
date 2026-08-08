import {
  auditLogsInfiniteQueryOptions,
  projectsQueryOptions,
} from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { LinkButton } from "@better-update/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";
import { Empty } from "@better-update/ui/components/empty";
import { Skeleton } from "@better-update/ui/components/skeleton";
import { FolderIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { PageHeader } from "../../../components/page-header";
import { ShippingActivityPanel } from "../../../components/shipping-activity";
import { DetailCardSkeleton } from "../../../components/skeletons";
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
      <span className="text-kumo-subtle flex min-w-0 items-center gap-1.5 text-xs">
        <span className="truncate">{entry.actorEmail}</span>
        {entry.source === "robot" ? <Badge variant="secondary">Robot</Badge> : null}
      </span>
    </span>
    <span className="text-kumo-subtle shrink-0 text-xs">
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
    return <p className="text-kumo-subtle px-2 py-4 text-sm">No activity recorded yet.</p>;
  }
  return (
    <div className="divide-kumo-line/60 flex flex-col divide-y">
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
          <Link to="/audit-log" className="text-kumo-subtle hover:text-kumo-default text-sm">
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

/** Where something last happened, as somewhere to go rather than a stat. */
const LatestProjectLink = ({ project }: { project: { name: string; slug: string } }) => (
  <Link
    to="/projects/$projectSlug"
    params={{ projectSlug: project.slug }}
    className="text-kumo-subtle hover:text-kumo-default text-sm"
  >
    Last activity in {project.name} →
  </Link>
);

const FirstProjectCard = () => (
  <Empty
    icon={<FolderIcon className="text-kumo-inactive size-10" />}
    title="Create your first project"
    description="Projects group the branches, channels, and updates for one app."
    contents={
      <LinkButton variant="primary" href="/projects">
        Go to projects
      </LinkButton>
    }
  />
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
      {/* The org's own shipping, with the standing counts alongside it. Where
          the latest activity happened is a fact about a project, so it hangs off
          the panel header as a link rather than occupying a metric slot. */}
      <ShippingActivityPanel
        orgId={orgId}
        title="Shipping across the organization"
        extras={[
          { label: "Active projects", value: projectsQ.data.total },
          { label: "Members", value: membersQ.data.length },
          ...(me.canInviteMembers
            ? [
                {
                  label: "Pending invites",
                  value: pendingInvites ?? <Skeleton className="h-6 w-8 rounded" />,
                },
              ]
            : []),
        ]}
        actions={latest ? <LatestProjectLink project={latest} /> : undefined}
      />
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
      {/* Shaped like the activity panel it stands in for, not like the row of
          tiles that used to be here. */}
      <Suspense fallback={<DetailCardSkeleton rows={1} columns={2} />}>
        <OverviewContent orgId={activeOrg.id} />
      </Suspense>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/")({
  component: OrgOverview,
});
