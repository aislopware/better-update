import { buildsQueryOptions, updatesQueryOptions } from "@better-update/api-client/react";
import { CloudArrowUpIcon, PackageIcon, StackIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { Suspense, useMemo } from "react";

import { DetailHeader, DetailNotFound } from "../../../../../../components/detail-header";
import { TablePanelSkeleton } from "../../../../../../components/skeletons";
import { PanelTitle, TablePanel } from "../../../../../../components/table-panel";
import { DataTableView } from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { RouterLinkButton } from "../../../../../../lib/router-link-button";
import { buildBuildsColumns } from "../builds/-builds-columns";
import { buildUpdateColumns } from "../updates/-updates-columns";

/**
 * How many rows each panel previews. Both lists show the same depth: this page
 * is a way into the two full lists, not a place to page through either, and a
 * runtime with twenty builds used to spend the whole screen on them before the
 * updates below were reached.
 */
const RUNTIME_PREVIEW_LIMIT = 10;

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

/**
 * What this runtime amounts to, in the line under its name: three numbers in
 * three boxes said the same thing across half a screen, and two of them were
 * printed again as the descriptions of the panels they counted.
 */
const RuntimeHeaderMeta = ({
  buildsCount,
  updatesCount,
  latestActivity,
}: {
  buildsCount: number;
  updatesCount: number;
  latestActivity: string | null;
}) => (
  <>
    <span>
      {buildsCount} {pluralize(buildsCount, "build")}
    </span>
    <span>
      {updatesCount} {pluralize(updatesCount, "update")}
    </span>
    {latestActivity ? (
      <span>
        Last activity <RelativeTime value={latestActivity} />
      </span>
    ) : null}
  </>
);

/**
 * The way out of a preview panel to the full list it previews.
 *
 * Parked in the panel header rather than under the rows: the closing bar counts
 * how much of the set is on screen, and "view all" is a way out of the panel
 * rather than a fact about it — which is where the Cloudflare dashboard puts
 * it too.
 */
const VIEW_ALL_CLASS = "text-kumo-subtle hover:text-kumo-default text-sm no-underline";

const RuntimeDetailContent = () => {
  const { version } = Route.useParams();
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug: projectSlug } = project;

  const { data: buildsData } = useSuspenseQuery(
    buildsQueryOptions(orgId, projectId, {
      runtimeVersion: version,
      limit: RUNTIME_PREVIEW_LIMIT,
    }),
  );
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, {
      runtimeVersion: version,
      limit: RUNTIME_PREVIEW_LIMIT,
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
    // so the table fits without horizontal scroll. The runtime column goes too:
    // every row on this page carries the version the page is named after.
    initialState: {
      columnVisibility: { buildNumber: false, size: false, runtimeVersion: false },
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const updateColumns = useMemo(
    () => buildUpdateColumns(projectSlug, orgId, projectId),
    [projectSlug, orgId, projectId],
  );
  const updatesTableData = useMemo(() => [...updatesData.items], [updatesData.items]);
  const updatesTable = useReactTable({
    data: updatesTableData,
    columns: [...updateColumns],
    enableMultiSort: false,
    initialState: { columnVisibility: { runtimeVersion: false, size: false } },
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
      <DetailHeader
        title={`Runtime v${version}`}
        meta={
          <RuntimeHeaderMeta
            buildsCount={buildsCount}
            updatesCount={updatesCount}
            latestActivity={latestActivity}
          />
        }
      />

      {buildsCount === 0 ? (
        <TablePanel title={<PanelTitle icon={<PackageIcon weight="bold" />} label="Builds" />}>
          <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">
            Build a binary against this runtime to see it here.
          </p>
        </TablePanel>
      ) : (
        <DataTableView
          table={buildsTable}
          columnsCount={buildColumns.length}
          title={<PanelTitle icon={<PackageIcon weight="bold" />} label="Builds" />}
          actions={
            buildsCount > buildsTableData.length ? (
              <Link
                to="/projects/$projectSlug/builds"
                params={{ projectSlug }}
                className={VIEW_ALL_CLASS}
              >
                View all builds →
              </Link>
            ) : null
          }
          isPlaceholderData={false}
          // A preview of the newest builds on this runtime rather than a page
          // of them, so the footer counts and does not paginate — the Builds
          // page is where they are paged through.
          countLabel={`${buildsTableData.length} of ${buildsCount}`}
          renderRowLink={(build, { className, children }) => (
            <Link
              to="/projects/$projectSlug/builds/$buildId"
              params={{ projectSlug, buildId: build.id }}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      )}

      {/* The updates below used to be item rows — name, platform and branch
          stacked in a paragraph — under a table of builds carrying the same
          kinds of fact in columns. One page, two vocabularies for two lists of
          the same shape; this is the one the Updates page already speaks. */}
      {updatesCount === 0 ? (
        <TablePanel
          title={<PanelTitle icon={<CloudArrowUpIcon weight="bold" />} label="Updates" />}
        >
          <p className="text-kumo-subtle m-0 px-4 py-3 text-sm">
            Publish an update with this runtime version to see it here.
          </p>
        </TablePanel>
      ) : (
        <DataTableView
          table={updatesTable}
          columnsCount={updateColumns.length}
          title={<PanelTitle icon={<CloudArrowUpIcon weight="bold" />} label="Updates" />}
          actions={
            updatesCount > updatesTableData.length ? (
              <Link
                to="/projects/$projectSlug/updates"
                params={{ projectSlug }}
                search={{ page: 1, sort: "-createdAt" as const }}
                className={VIEW_ALL_CLASS}
              >
                View all updates →
              </Link>
            ) : null
          }
          isPlaceholderData={false}
          countLabel={`${updatesTableData.length} of ${updatesCount}`}
          renderRowLink={(update, { className, children }) => (
            <Link
              to="/projects/$projectSlug/updates/$updateId"
              params={{ projectSlug, updateId: update.id }}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      )}
    </>
  );
};

// Two table panels arrive, so two table panels stand in for them — the field
// grids here stood in for lists that have never been fields.
const RuntimeDetailSkeleton = () => (
  <>
    <DetailHeader title="Runtime" />
    <TablePanelSkeleton columns={5} rows={4} />
    <TablePanelSkeleton columns={5} rows={4} />
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
