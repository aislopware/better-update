import { buildsQueryOptions, updatesQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { CloudArrowUpIcon, PackageIcon, StackIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Suspense, useMemo } from "react";

import type { PlatformValue } from "@better-update/api-client/react";

import { PlatformIndicator } from "../../../../../../components/attribute-badges";
import { DetailHeader, DetailNotFound } from "../../../../../../components/detail-header";
import { DetailCardSkeleton, SummaryCardsSkeleton } from "../../../../../../components/skeletons";
import { StatCard } from "../../../../../../components/stat-card";
import { TablePanel } from "../../../../../../components/table-panel";
import { DataTableView } from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { RouterLinkButton } from "../../../../../../lib/router-link-button";
import { buildBuildsColumns } from "../builds/-builds-columns";

const RUNTIME_PAGE_LIMIT = 25;

/** The updates card only renders this many rows; "View all" covers the rest. */
const RUNTIME_UPDATES_LIMIT = 10;

const RuntimeNotFoundState = ({ projectSlug }: { projectSlug: string }) => (
  <DetailNotFound
    icon={<StackIcon />}
    title="No data for this runtime version"
    description="Nothing in this project references this runtime yet."
    backLink={
      <RouterLinkButton to="/projects/$projectSlug/runtimes" params={{ projectSlug }}>
        Back to runtimes
      </RouterLinkButton>
    }
  />
);

const RuntimeSummaryCards = ({
  buildsCount,
  updatesCount,
  latestActivity,
}: {
  buildsCount: number;
  updatesCount: number;
  latestActivity: string | null;
}) => (
  <div className="grid gap-4 sm:grid-cols-3">
    <StatCard label="Builds" value={buildsCount} />
    <StatCard label="Updates" value={updatesCount} />
    <StatCard label="Latest activity" value={<RelativeTime value={latestActivity} />} />
  </div>
);

/** Section title with its glyph, shared by the two panels on this page. */
const RuntimeSectionTitle = ({
  icon: Icon,
  label,
}: {
  icon: typeof PackageIcon;
  label: string;
}) => (
  <span className="flex items-center gap-2">
    <Icon weight="bold" className="text-kumo-subtle size-4" />
    {label}
  </span>
);

const UpdateRow = ({
  update,
  branchName,
  projectSlug,
}: {
  update: {
    readonly id: string;
    readonly groupId: string;
    readonly platform: PlatformValue;
    readonly message: string;
    readonly branchId: string;
    readonly createdAt: string;
    readonly rolloutPercentage: number;
  };
  branchName: string | undefined;
  projectSlug: string;
}) => (
  <Link
    to="/projects/$projectSlug/updates/$updateId"
    params={{ projectSlug, updateId: update.id }}
    className="hover:bg-kumo-tint/50 border-kumo-line/60 flex items-center justify-between gap-3 border-b px-4 py-3 last:border-0"
  >
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span className="truncate text-sm font-medium">
          {update.message || `Update ${update.groupId.slice(0, 8)}`}
        </span>
        {update.rolloutPercentage < 100 ? (
          <Badge variant="secondary">Rollout {update.rolloutPercentage}%</Badge>
        ) : null}
      </span>
      <span className="text-kumo-subtle flex items-center gap-2 text-xs">
        <PlatformIndicator platform={update.platform} className="gap-1" />
        {branchName ? (
          <span className="truncate">{branchName}</span>
        ) : (
          <code className="font-mono" title={update.branchId}>
            {update.branchId.slice(0, 8)}
          </code>
        )}
      </span>
    </div>
    <RelativeTime value={update.createdAt} className="text-kumo-subtle shrink-0 text-xs" />
  </Link>
);

const RuntimeDetailContent = () => {
  const { version } = Route.useParams();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug: projectSlug } = project;

  const { data: buildsData } = useSuspenseQuery(
    buildsQueryOptions(orgId, projectId, {
      runtimeVersion: version,
      limit: RUNTIME_PAGE_LIMIT,
    }),
  );
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, {
      runtimeVersion: version,
      limit: RUNTIME_UPDATES_LIMIT,
    }),
  );

  const buildsCount = buildsData.total;
  const updatesCount = updatesData.total;
  const latestActivity = useMemo(() => {
    const buildTimes = buildsData.items.map((build) => build.createdAt);
    const updateTimes = updatesData.items.map((update) => update.createdAt);
    const candidates = [...buildTimes, ...updateTimes];
    if (candidates.length === 0) {
      return null;
    }
    return candidates.reduce((acc, value) => (value > acc ? value : acc));
  }, [buildsData.items, updatesData.items]);

  const buildColumns = useMemo(() => buildBuildsColumns(orgId, projectId), [orgId, projectId]);
  const buildsTableData = useMemo(() => [...buildsData.items], [buildsData.items]);
  const buildsTable = useReactTable({
    data: buildsTableData,
    columns: [...buildColumns],
    enableMultiSort: false,
    // Match the Builds page defaults — secondary numeric columns stay hidden
    // so the table fits without horizontal scroll.
    initialState: { columnVisibility: { buildNumber: false, size: false } },
    getCoreRowModel: getCoreRowModel(),
  });

  if (buildsCount === 0 && updatesCount === 0) {
    return (
      <>
        <DetailHeader title={`Runtime v${version}`} />
        <RuntimeNotFoundState projectSlug={projectSlug} />
      </>
    );
  }

  return (
    <>
      <DetailHeader title={`Runtime v${version}`} />

      <RuntimeSummaryCards
        buildsCount={buildsCount}
        updatesCount={updatesCount}
        latestActivity={latestActivity}
      />

      {buildsCount === 0 ? (
        <TablePanel
          title={<RuntimeSectionTitle icon={PackageIcon} label="Builds on this runtime" />}
        >
          <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">
            Build a binary against this runtime to see it here.
          </p>
        </TablePanel>
      ) : (
        <DataTableView
          table={buildsTable}
          columnsCount={buildColumns.length}
          title={<RuntimeSectionTitle icon={PackageIcon} label="Builds on this runtime" />}
          description={`${buildsCount} ${pluralize(buildsCount, "build")} on runtime v${version}`}
          isPlaceholderData={false}
          // A preview of the newest builds on this runtime rather than a page
          // of them, so the footer counts and does not paginate — the Builds
          // page is where they are paged through.
          countLabel={`${buildsTableData.length} of ${buildsCount}`}
        />
      )}

      <TablePanel
        title={<RuntimeSectionTitle icon={CloudArrowUpIcon} label="Updates on this runtime" />}
        description={
          updatesCount === 0
            ? "No updates yet"
            : `${updatesCount} ${pluralize(updatesCount, "update")} published on runtime v${version}`
        }
        footer={
          updatesCount > RUNTIME_UPDATES_LIMIT ? (
            <Link
              to="/projects/$projectSlug/updates"
              params={{ projectSlug }}
              search={{ page: 1, sort: "-createdAt" as const }}
              className="text-kumo-subtle hover:text-kumo-default text-sm"
            >
              View all updates →
            </Link>
          ) : undefined
        }
      >
        {updatesCount === 0 ? (
          <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">
            Publish an update with this runtime version to see it here.
          </p>
        ) : (
          updatesData.items.map((update) => (
            <UpdateRow
              key={update.id}
              update={update}
              branchName={update.branchName}
              projectSlug={projectSlug}
            />
          ))
        )}
      </TablePanel>
    </>
  );
};

const RuntimeDetailSkeleton = () => (
  <>
    <DetailHeader title="Runtime" />
    <SummaryCardsSkeleton count={3} />
    <DetailCardSkeleton rows={3} columns={2} />
    <DetailCardSkeleton rows={3} columns={1} />
  </>
);

const RuntimeDetailPage = () => (
  <div className="flex w-full flex-col gap-4">
    <Suspense fallback={<RuntimeDetailSkeleton />}>
      <RuntimeDetailContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/runtimes/$version")({
  component: RuntimeDetailPage,
});
