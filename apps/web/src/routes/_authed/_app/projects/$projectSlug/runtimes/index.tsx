import { buildsQueryOptions, updatesQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { LayersIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type { ColumnDef } from "@tanstack/react-table";

import { ProjectSubpageHeader } from "../-project-subpage-header";
import { TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  fireAndForget,
  pageParam,
} from "../../../../../../lib/data-table";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";
import { pluralize } from "../../../../../../lib/pluralize";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../../queries/constants";

interface RuntimeAggregation {
  readonly version: string;
  readonly buildsCount: number;
  readonly updatesCount: number;
  readonly latestActivity: string | null;
}

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

const RuntimesSkeleton = () => (
  <>
    <div className="flex items-center justify-between">
      <ProjectSubpageHeader title="Runtimes" />
    </div>
    <TableSkeleton columns={4} rows={5} />
  </>
);

const buildColumns = (): readonly ColumnDef<RuntimeAggregation>[] => [
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
      <Badge variant={row.original.buildsCount > 0 ? "secondary" : "outline"}>
        {row.original.buildsCount} {pluralize(row.original.buildsCount, "build")}
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "updatesCount",
    header: "Updates",
    cell: ({ row }) => (
      <Badge variant={row.original.updatesCount > 0 ? "secondary" : "outline"}>
        {row.original.updatesCount} {pluralize(row.original.updatesCount, "update")}
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "latestActivity",
    header: "Latest activity",
    cell: ({ row }) =>
      row.original.latestActivity === null ? (
        <span className="text-muted-foreground text-xs">—</span>
      ) : (
        formatRelativeTime(row.original.latestActivity)
      ),
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
];

interface RuntimeBucket {
  readonly buildsCount: number;
  readonly updatesCount: number;
  readonly latest: string | null;
}

const EMPTY_BUCKET: RuntimeBucket = { buildsCount: 0, updatesCount: 0, latest: null };

const newerOf = (left: string | null, right: string): string =>
  left === null || right > left ? right : left;

const aggregateRuntimes = (
  builds: readonly { readonly runtimeVersion: string | null; readonly createdAt: string }[],
  updates: readonly { readonly runtimeVersion: string; readonly createdAt: string }[],
): readonly RuntimeAggregation[] => {
  const afterBuilds = builds.reduce<ReadonlyMap<string, RuntimeBucket>>((map, build) => {
    if (build.runtimeVersion === null) {
      return map;
    }
    const prior = map.get(build.runtimeVersion) ?? EMPTY_BUCKET;
    return new Map(map).set(build.runtimeVersion, {
      buildsCount: prior.buildsCount + 1,
      updatesCount: prior.updatesCount,
      latest: newerOf(prior.latest, build.createdAt),
    });
  }, new Map<string, RuntimeBucket>());

  const merged = updates.reduce<ReadonlyMap<string, RuntimeBucket>>((map, update) => {
    const prior = map.get(update.runtimeVersion) ?? EMPTY_BUCKET;
    return new Map(map).set(update.runtimeVersion, {
      buildsCount: prior.buildsCount,
      updatesCount: prior.updatesCount + 1,
      latest: newerOf(prior.latest, update.createdAt),
    });
  }, afterBuilds);

  return [...merged.entries()]
    .map(([version, entry]) => ({
      version,
      buildsCount: entry.buildsCount,
      updatesCount: entry.updatesCount,
      latestActivity: entry.latest,
    }))
    .toSorted((left, right) => {
      if (left.latestActivity === null && right.latestActivity === null) {
        return 0;
      }
      if (left.latestActivity === null) {
        return 1;
      }
      if (right.latestActivity === null) {
        return -1;
      }
      return right.latestActivity.localeCompare(left.latestActivity);
    });
};

const RuntimesContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug: projectSlug } = project;
  const routeNavigate = Route.useNavigate();

  const { page } = Route.useSearch();

  const { data: buildsData } = useSuspenseQuery(
    buildsQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const { data: updatesData } = useSuspenseQuery(
    updatesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );

  const runtimes = useMemo(
    () => aggregateRuntimes(buildsData.items, updatesData.items),
    [buildsData.items, updatesData.items],
  );

  const columns = useMemo(() => buildColumns(), []);

  const pageStart = (page - 1) * PAGE_SIZE;
  const pageSlice = useMemo(
    () => runtimes.slice(pageStart, pageStart + PAGE_SIZE),
    [runtimes, pageStart],
  );
  const tableData = useMemo(() => [...pageSlice], [pageSlice]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    manualSorting: true,
    enableMultiSort: false,
    getCoreRowModel: getCoreRowModel(),
  });

  if (runtimes.length === 0) {
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
    runtimes.length,
    pageSlice.length,
    page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${runtimes.length} ${pluralize(runtimes.length, "runtime")}`;

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
        isPlaceholderData={false}
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

const RuntimesPage = () => (
  <Suspense fallback={<RuntimesSkeleton />}>
    <RuntimesContent />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/runtimes/")({
  validateSearch: zodValidator(runtimesSearchSchema),
  component: RuntimesPage,
});
