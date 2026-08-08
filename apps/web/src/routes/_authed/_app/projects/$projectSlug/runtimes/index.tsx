import { runtimesQueryOptions } from "@better-update/api-client/react";
import { Empty } from "@better-update/ui/components/empty";
import { StackIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { useMemo } from "react";
import { z } from "zod";

import type { RuntimeAggregate } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { PlatformIndicator } from "../../../../../../components/attribute-badges";
import { PageHeader } from "../../../../../../components/page-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  fireAndForget,
  pageParam,
} from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";

const runtimesSearchSchema = z.object({
  page: pageParam(),
});

const RuntimesEmptyState = () => (
  <Empty
    icon={<StackIcon className="text-kumo-inactive size-10" />}
    title="No runtime versions yet"
    description="Runtime versions appear here once you publish a build or update."
  />
);

const SINGLE_PLATFORM = 1;

const RuntimeVersionCell = ({ runtime }: { runtime: RuntimeAggregate }) => {
  const [only] = runtime.platforms;
  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-2 font-medium">
        <StackIcon weight="bold" className="text-kumo-subtle size-4" />v{runtime.version}
      </span>
      {runtime.platforms.length === SINGLE_PLATFORM && only ? (
        <span className="text-kumo-subtle flex items-center gap-1.5 text-xs">
          <PlatformIndicator platform={only} className="gap-1" /> only
        </span>
      ) : null}
    </div>
  );
};

const columns: readonly ColumnDef<RuntimeAggregate>[] = [
  {
    id: "version",
    header: "Runtime",
    // Both platforms reporting a runtime is the ordinary case and goes unsaid;
    // a version only one of them ever shipped is the row worth a second look,
    // so that is the only one that names a platform.
    cell: ({ row }) => <RuntimeVersionCell runtime={row.original} />,
    enableSorting: false,
    meta: { primary: true },
  },
  // The header already says what the number counts, so the cells are numbers:
  // repeating "builds" down the column adds width without adding meaning, and
  // a right-aligned tabular column is scannable in a way a ragged one is not.
  {
    id: "buildsCount",
    header: "Builds",
    cell: ({ row }) => (
      <span className={row.original.buildsCount > 0 ? undefined : "text-kumo-subtle"}>
        {row.original.buildsCount}
      </span>
    ),
    enableSorting: false,
    meta: { cellType: "numeric" },
  },
  {
    id: "updatesCount",
    header: "Updates",
    cell: ({ row }) => (
      <span className={row.original.updatesCount > 0 ? undefined : "text-kumo-subtle"}>
        {row.original.updatesCount}
      </span>
    ),
    enableSorting: false,
    meta: { cellType: "numeric" },
  },
  {
    id: "latestActivity",
    header: "Latest activity",
    cell: ({ row }) => <RelativeTime value={row.original.latestActivity} />,
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
];

const RuntimesContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug: projectSlug } = project;
  const routeNavigate = Route.useNavigate();

  const { page } = Route.useSearch();

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...runtimesQueryOptions(orgId, projectId, { page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    enableSorting: false,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title="Runtimes"
          description="Native runtime versions this project's builds report, and what can target them."
        />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={4} rows={5} />
        )}
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title="Runtimes"
          description="Native runtime versions this project's builds report, and what can target them."
        />
        <RuntimesEmptyState />
      </div>
    );
  }

  const { safePage } = computePagination(data.total, page);

  const onPageChange = (next: number) => {
    fireAndForget(routeNavigate({ to: ".", search: (prev) => ({ ...prev, page: next }) }));
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Runtimes"
        description="Native runtime versions this project's builds report, and what can target them."
      />
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        pagination={{
          page: safePage,
          perPage: PAGE_SIZE,
          totalCount: data.total,
          entity: pluralize(data.total, "runtime"),
          onChange: onPageChange,
        }}
        onRowClick={async (runtime) => {
          await routeNavigate({
            to: "/projects/$projectSlug/runtimes/$version",
            params: { projectSlug, version: runtime.version },
          });
        }}
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/runtimes/")({
  validateSearch: zodValidator(runtimesSearchSchema),
  component: RuntimesContent,
});
