import {
  branchesQueryOptions,
  channelsQueryOptions,
  updatesQueryOptions,
} from "@better-update/api-client/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { CloudUploadIcon, Loader2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import type { UpdateSort, UpdateSortColumn } from "@better-update/api-client/react";
import type { SortingState } from "@tanstack/react-table";

import { ProjectSubpageHeader } from "../-project-subpage-header";
import { pluralize } from "../../../../../../lib/pluralize";
import { buildUpdateColumns } from "./-updates-columns";
import { UpdatesFilterBar, UpdatesTableView } from "./-updates-view";

const PAGE_SIZE = 50;

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }];

const SORT_COLUMNS = [
  "createdAt",
  "runtimeVersion",
  "platform",
  "rolloutPercentage",
] as const satisfies readonly UpdateSortColumn[];

const toApiSort = (sorting: SortingState): UpdateSort | undefined => {
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

const UpdatesEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <CloudUploadIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No updates yet</EmptyTitle>
      <EmptyDescription>Publish your first update using the CLI to see it here.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

interface FiltersState {
  readonly branchFilter: string | undefined;
  readonly platformFilter: "ios" | "android" | undefined;
  readonly sorting: SortingState;
  readonly page: number;
}

const useUpdatesData = (orgId: string, projectId: string, slug: string, state: FiltersState) => {
  const apiSort = toApiSort(state.sorting);
  const updatesQuery = useQuery({
    ...updatesQueryOptions(orgId, projectId, {
      page: state.page,
      limit: PAGE_SIZE,
      ...(state.branchFilter ? { branchId: state.branchFilter } : {}),
      ...(state.platformFilter ? { platform: state.platformFilter } : {}),
      ...(apiSort ? { sort: apiSort } : {}),
    }),
    placeholderData: keepPreviousData,
  });
  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: 100 }),
  );
  const { data: channelsData } = useSuspenseQuery(
    channelsQueryOptions(orgId, projectId, { limit: 100 }),
  );
  const branchNames = useMemo(
    () => new Map(branchesData.items.map((branch) => [branch.id, branch.name])),
    [branchesData.items],
  );
  const columns = useMemo(
    () => buildUpdateColumns(branchNames, channelsData.items, slug, orgId, projectId),
    [branchNames, channelsData.items, slug, orgId, projectId],
  );
  return {
    updatesQuery,
    branches: branchesData.items,
    columns,
  };
};

const UpdatesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug } = project;

  const [filters, setFilters] = useState<FiltersState>({
    branchFilter: undefined,
    platformFilter: undefined,
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

  const { updatesQuery, branches, columns } = useUpdatesData(orgId, projectId, slug, filters);
  const { data, isPlaceholderData, isLoading } = updatesQuery;
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

  const branchFilterLabels: Record<string, string> = {
    all: "All branches",
    ...Object.fromEntries(branches.map((branch) => [branch.id, branch.name])),
  };
  const filterControls = (
    <UpdatesFilterBar
      branches={branches}
      branchFilterLabels={branchFilterLabels}
      branchFilter={filters.branchFilter}
      platformFilter={filters.platformFilter}
      onBranchFilter={(branchFilter) => {
        setFilters((prev) => ({ ...prev, branchFilter, page: 1 }));
      }}
      onPlatformFilter={(platformFilter) => {
        setFilters((prev) => ({ ...prev, platformFilter, page: 1 }));
      }}
    />
  );

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <ProjectSubpageHeader title="Updates" />
          <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
        </div>
        <div className="flex justify-center py-12">
          <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
        </div>
      </div>
    );
  }

  const filtersActive = Boolean(filters.branchFilter) || Boolean(filters.platformFilter);

  if (data.total === 0 && !filtersActive) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <ProjectSubpageHeader title="Updates" />
          <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
        </div>
        <UpdatesEmptyState />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    filters.page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "update")}${
    filtersActive ? " (filtered)" : ""
  }`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <ProjectSubpageHeader title="Updates" />
        <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
      </div>
      {data.total === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
          No updates match your filters.
        </p>
      ) : (
        <UpdatesTableView
          table={table}
          columnsCount={columns.length}
          isPlaceholderData={isPlaceholderData}
          countLabel={countLabel}
          safePage={safePage}
          totalPages={totalPages}
          onPageChange={(page) => {
            setFilters((prev) => ({ ...prev, page }));
          }}
        />
      )}
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/updates/")({
  component: UpdatesPage,
});
