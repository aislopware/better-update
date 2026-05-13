import {
  buildCompatibilityMatrixQueryOptions,
  buildsQueryOptions,
} from "@better-update/api-client/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { PackageIcon } from "lucide-react";
import { Suspense, useMemo, useState } from "react";

import type {
  BuildDistribution,
  BuildSort,
  BuildSortColumn,
} from "@better-update/api-client/react";
import type { SortingState } from "@tanstack/react-table";

import { CompatibilityMatrix } from "../-compatibility-matrix";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { TableSkeleton } from "../../../../../../components/skeletons";
import { pluralize } from "../../../../../../lib/pluralize";
import { buildBuildsColumns } from "./-builds-columns";
import { BuildsFilterBar, BuildsTableView } from "./-builds-view";

const PAGE_SIZE = 50;

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }];

const SORT_COLUMNS = [
  "createdAt",
  "platform",
  "distribution",
  "runtimeVersion",
  "appVersion",
] as const satisfies readonly BuildSortColumn[];

const toApiSort = (sorting: SortingState): BuildSort | undefined => {
  const [first] = sorting;
  if (!first) {
    return undefined;
  }
  const column = SORT_COLUMNS.find((col) => col === first.id);
  if (!column) {
    return undefined;
  }
  return first.desc ? `-${column}` : column;
};

const computePagination = (total: number, itemCount: number, page: number) => {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const fromIndex = itemCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toIndex = (safePage - 1) * PAGE_SIZE + itemCount;
  return { totalPages, safePage, fromIndex, toIndex };
};

const BuildsEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <PackageIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No builds yet</EmptyTitle>
      <EmptyDescription>Upload your first build using the CLI to get started.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

interface BuildsFiltersState {
  readonly platformFilter: "ios" | "android" | undefined;
  readonly distributionFilter: BuildDistribution | undefined;
  readonly sorting: SortingState;
  readonly page: number;
}

const isBuildDistribution = (value: string | undefined): value is BuildDistribution =>
  value === "app-store" ||
  value === "ad-hoc" ||
  value === "development" ||
  value === "enterprise" ||
  value === "simulator" ||
  value === "play-store" ||
  value === "direct";

const BuildsSkeleton = () => (
  <>
    <div className="flex items-center justify-between gap-2">
      <ProjectSubpageHeader title="Builds" />
    </div>
    <TableSkeleton columns={6} rows={6} />
  </>
);

const BuildsContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug: projectSlug } = project;
  const navigate = useNavigate();

  const [filters, setFilters] = useState<BuildsFiltersState>({
    platformFilter: undefined,
    distributionFilter: undefined,
    sorting: DEFAULT_SORTING,
    page: 1,
  });

  const handleSortingChange = (updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev.sorting) : updater;
      return {
        ...prev,
        sorting: next.length === 0 ? DEFAULT_SORTING : next.slice(0, 1),
        page: 1,
      };
    });
  };

  const apiSort = toApiSort(filters.sorting);
  const { data, isPlaceholderData, isLoading } = useQuery({
    ...buildsQueryOptions(orgId, projectId, {
      page: filters.page,
      limit: PAGE_SIZE,
      ...(filters.platformFilter ? { platform: filters.platformFilter } : {}),
      ...(filters.distributionFilter ? { distribution: filters.distributionFilter } : {}),
      ...(apiSort ? { sort: apiSort } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  const { data: matrix } = useSuspenseQuery(buildCompatibilityMatrixQueryOptions(orgId, projectId));

  const columns = useMemo(() => buildBuildsColumns(orgId, projectId), [orgId, projectId]);
  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    state: { sorting: filters.sorting },
    onSortingChange: handleSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const filterControls = (
    <BuildsFilterBar
      platformFilter={filters.platformFilter}
      distributionFilter={filters.distributionFilter}
      onPlatformFilter={(platformFilter) => {
        setFilters((prev) => ({ ...prev, platformFilter, page: 1 }));
      }}
      onDistributionFilter={(value) => {
        const distributionFilter = isBuildDistribution(value) ? value : undefined;
        setFilters((prev) => ({ ...prev, distributionFilter, page: 1 }));
      }}
    />
  );

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <ProjectSubpageHeader title="Builds" />
          <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
        </div>
        <TableSkeleton columns={6} rows={6} />
      </div>
    );
  }

  const filtersActive = Boolean(filters.platformFilter) || Boolean(filters.distributionFilter);

  if (data.total === 0 && !filtersActive) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <ProjectSubpageHeader title="Builds" />
          <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
        </div>
        <BuildsEmptyState />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    filters.page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "build")}${
    filtersActive ? " (filtered)" : ""
  }`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <ProjectSubpageHeader title="Builds" />
        <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
      </div>
      <CompatibilityMatrix
        builds={tableData}
        matrix={matrix}
        missingRuntimeVersions={matrix.missingRuntimeVersions}
      />
      {data.total === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          No builds match your filters.
        </p>
      ) : (
        <BuildsTableView
          table={table}
          columnsCount={columns.length}
          isPlaceholderData={isPlaceholderData}
          countLabel={countLabel}
          safePage={safePage}
          totalPages={totalPages}
          onPageChange={(page) => {
            setFilters((prev) => ({ ...prev, page }));
          }}
          onRowClick={async (build) => {
            await navigate({
              to: "/projects/$projectSlug/builds/$buildId",
              params: { projectSlug, buildId: build.id },
            });
          }}
        />
      )}
    </div>
  );
};

const BuildsPage = () => (
  <Suspense fallback={<BuildsSkeleton />}>
    <BuildsContent />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/builds/")({
  component: BuildsPage,
});
