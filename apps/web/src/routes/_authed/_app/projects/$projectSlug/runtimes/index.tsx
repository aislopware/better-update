import { runtimesQueryOptions } from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { LayersIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { RuntimeAggregate } from "@better-update/api";
import type { ColumnDef } from "@tanstack/react-table";

import { ProjectSubpageHeader } from "../-project-subpage-header";
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
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LayersIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No runtime versions yet</EmptyTitle>
        <EmptyDescription>
          Runtime versions appear here once you publish a build or update.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const columns: readonly ColumnDef<RuntimeAggregate>[] = [
  {
    id: "version",
    header: "Runtime",
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        <LayersIcon strokeWidth={2} className="text-muted-foreground size-4" />v
        {row.original.version}
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "buildsCount",
    header: "Builds",
    cell: ({ row }) => (
      <span className={row.original.buildsCount > 0 ? undefined : "text-muted-foreground"}>
        {row.original.buildsCount} {pluralize(row.original.buildsCount, "build")}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "updatesCount",
    header: "Updates",
    cell: ({ row }) => (
      <span className={row.original.updatesCount > 0 ? undefined : "text-muted-foreground"}>
        {row.original.updatesCount} {pluralize(row.original.updatesCount, "update")}
      </span>
    ),
    enableSorting: false,
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
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Runtimes" />
        </div>
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
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Runtimes" />
        </div>
        <RuntimesEmptyState />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "runtime")}`;

  const onPageChange = (next: number) => {
    fireAndForget(routeNavigate({ to: ".", search: (prev) => ({ ...prev, page: next }) }));
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <ProjectSubpageHeader title="Runtimes" />
      </div>
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        countLabel={countLabel}
        safePage={safePage}
        totalPages={totalPages}
        onPageChange={onPageChange}
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
