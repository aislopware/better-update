import { updatesQueryOptions } from "@better-update/api-client/react";
import { Empty } from "@better-update/ui/components/empty";
import { CloudArrowUpIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type { UpdateSortColumn } from "@better-update/api-client/react";

import { CompareUpdatesDialog } from "../-compare-updates-dialog";
import { CliCommandBlock } from "../../../../../../components/cli-command-block";
import { PageHeader } from "../../../../../../components/page-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { FilterBarSkeleton, TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableToolbar,
  DataTableView,
  DataTableViewOptions,
  PAGE_SIZE,
  computePagination,
  enumArrayParam,
  fireAndForget,
  freeStringArrayParam,
  optionalStringParam,
  pageParam,
  PinnedFilterChip,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
  withoutPinnedColumns,
} from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { buildUpdateColumns } from "./-updates-columns";
import { UpdatesFilterBar } from "./-updates-view";

const SORT_COLUMNS = [
  "createdAt",
  "runtimeVersion",
  "platform",
  "rolloutPercentage",
] as const satisfies readonly UpdateSortColumn[];

const DEFAULT_SORT = "-createdAt" as const;

const PLATFORMS = ["ios", "android"] as const;

const SEARCH_DEBOUNCE_MS = 300;

const updatesSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  platform: enumArrayParam(PLATFORMS),
  branchId: freeStringArrayParam(),
  // Set by following a runtime into its updates, never picked here — the
  // toolbar shows it as a chip that can only be dropped.
  runtimeVersion: optionalStringParam(),
  query: queryParam(),
});

const UpdatesEmptyState = () => (
  <Empty
    icon={<CloudArrowUpIcon className="text-kumo-inactive size-10" />}
    title="No updates yet"
    description="Publish from your app repo — updates land on a branch and reach devices through its channel."
    contents={
      <CliCommandBlock
        commands={['better-update update publish --branch main --message "First update"']}
      />
    }
  />
);

const UpdatesSkeleton = () => (
  <>
    <PageHeader title="Updates" description="Every JavaScript bundle published to this project." />
    <FilterBarSkeleton hasSearch selectCount={2} />
    <TableSkeleton columns={7} rows={6} />
  </>
);

interface UseUpdatesDataArgs {
  readonly orgId: string;
  readonly projectId: string;
  readonly slug: string;
  readonly page: number;
  readonly apiSort: (typeof SORT_COLUMNS)[number] | `-${(typeof SORT_COLUMNS)[number]}`;
  readonly branchId: readonly string[];
  readonly platform: readonly ("ios" | "android")[];
  readonly runtimeVersion: string | undefined;
  readonly query: string;
}

const useUpdatesData = ({
  orgId,
  projectId,
  slug,
  page,
  apiSort,
  branchId,
  platform,
  runtimeVersion,
  query,
}: UseUpdatesDataArgs) => {
  // Platform is a two-value enum, so "both selected" ≡ no filter and the API
  // keeps its single-value param; branches are a true multi filter.
  const platformParam = platform.length === 1 ? platform[0] : undefined;

  const updatesQuery = useQuery({
    ...updatesQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(branchId.length > 0 ? { branchId } : {}),
      ...(platformParam ? { platform: platformParam } : {}),
      ...(runtimeVersion ? { runtimeVersion } : {}),
      ...(query ? { query } : {}),
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  const branchIsPinned = branchId.length === 1;
  const platformIsPinned = platform.length === 1;
  const columns = useMemo(
    () =>
      withoutPinnedColumns(buildUpdateColumns(slug, orgId, projectId), {
        branch: branchIsPinned,
        platform: platformIsPinned,
        runtimeVersion: runtimeVersion !== undefined,
      }),
    [slug, orgId, projectId, branchIsPinned, platformIsPinned, runtimeVersion],
  );

  return { updatesQuery, columns };
};

const UpdatesContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug } = project;
  const routeNavigate = Route.useNavigate();

  const { page, sort, platform, branchId, runtimeVersion, query: urlQuery } = Route.useSearch();
  const { sorting, apiSort, onSortingChange, onPageChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate: routeNavigate,
  });

  const { draft: searchDraft, setDraft: handleSearchChange } = useDebouncedSearch({
    initial: urlQuery,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      fireAndForget(
        routeNavigate({
          to: ".",
          search: (prev) => ({ ...prev, query: value, page: 1 }),
          replace: true,
        }),
      );
    },
  });

  const handleBranchFilter = (next: readonly string[]) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, branchId: [...next], page: 1 }),
      }),
    );
  };

  const handlePlatformFilter = (next: readonly ("ios" | "android")[]) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, platform: [...next], page: 1 }),
      }),
    );
  };

  const handleReset = () => {
    handleSearchChange("");
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          branchId: [],
          platform: [],
          runtimeVersion: undefined,
          query: "",
          page: 1,
        }),
      }),
    );
  };

  const { updatesQuery, columns } = useUpdatesData({
    orgId,
    projectId,
    slug,
    page,
    apiSort,
    branchId,
    platform,
    runtimeVersion,
    query: urlQuery,
  });

  const { data, error, isPlaceholderData, isLoading, refetch } = updatesQuery;
  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);
  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    // Size stays opt-in (View options) so the table fits without horizontal scroll.
    initialState: { columnVisibility: { size: false } },
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const header = (
    <PageHeader
      title="Updates"
      description="Every JavaScript bundle published to this project."
      actions={<CompareUpdatesDialog orgId={orgId} projectId={projectId} />}
    />
  );

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        {header}
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <>
            <FilterBarSkeleton hasSearch selectCount={2} />
            <TableSkeleton columns={7} rows={6} />
          </>
        )}
      </div>
    );
  }

  const filtersActive =
    branchId.length > 0 ||
    platform.length > 0 ||
    runtimeVersion !== undefined ||
    urlQuery.length > 0;

  if (data.total === 0 && !filtersActive && searchDraft.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        {header}
        <UpdatesEmptyState />
      </div>
    );
  }

  const { safePage } = computePagination(data.total, page);

  return (
    <div className="flex w-full flex-col gap-4">
      {header}
      <DataTableToolbar
        search={{
          value: searchDraft,
          onChange: handleSearchChange,
          placeholder: "Search by message or commit…",
        }}
        isFiltered={filtersActive || searchDraft.length > 0}
        onReset={handleReset}
        actions={<DataTableViewOptions table={table} />}
      >
        <UpdatesFilterBar
          orgId={orgId}
          projectId={projectId}
          branchFilter={branchId}
          platformFilter={platform}
          onBranchFilter={handleBranchFilter}
          onPlatformFilter={handlePlatformFilter}
        />
        {runtimeVersion === undefined ? null : (
          <PinnedFilterChip
            label="Runtime"
            value={`v${runtimeVersion}`}
            onClear={() => {
              fireAndForget(
                routeNavigate({
                  to: ".",
                  search: (prev) => ({ ...prev, runtimeVersion: undefined, page: 1 }),
                }),
              );
            }}
          />
        )}
      </DataTableToolbar>
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        pagination={{
          page: safePage,
          perPage: PAGE_SIZE,
          totalCount: data.total,
          entity: pluralize(data.total, "update"),
          isFiltered: filtersActive,
          onChange: onPageChange,
        }}
        emptyMessage="No updates match your filters."
        renderRowLink={(update, { className, children }) => (
          <Link
            to="/projects/$projectSlug/updates/$updateId"
            params={{ projectSlug: slug, updateId: update.id }}
            className={className}
          >
            {children}
          </Link>
        )}
      />
    </div>
  );
};

const UpdatesPage = () => (
  <Suspense fallback={<UpdatesSkeleton />}>
    <UpdatesContent />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/updates/")({
  validateSearch: zodValidator(updatesSearchSchema),
  component: UpdatesPage,
});
