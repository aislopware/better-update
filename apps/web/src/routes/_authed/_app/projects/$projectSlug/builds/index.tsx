import {
  buildCompatibilityMatrixQueryOptions,
  buildsQueryOptions,
} from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { PackageIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type {
  BuildAudience,
  BuildDistribution,
  BuildSortColumn,
} from "@better-update/api-client/react";

import { CompatibilityMatrix } from "../-compatibility-matrix";
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
  fireAndForget,
  enumArrayParam,
  pageParam,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { buildBuildsColumns } from "./-builds-columns";
import { BuildsFilterBar } from "./-builds-view";

const SORT_COLUMNS = [
  "createdAt",
  "platform",
  "distribution",
  "runtimeVersion",
  "appVersion",
] as const satisfies readonly BuildSortColumn[];

const DEFAULT_SORT = "-createdAt" as const;

const PLATFORMS = ["ios", "android"] as const;
const DISTRIBUTIONS = [
  "app-store",
  "ad-hoc",
  "development",
  "enterprise",
  "simulator",
  "play-store",
  "direct",
] as const satisfies readonly BuildDistribution[];
const AUDIENCES = ["internal", "store"] as const satisfies readonly BuildAudience[];

const SEARCH_DEBOUNCE_MS = 300;

const buildsSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  platform: enumArrayParam(PLATFORMS),
  distribution: enumArrayParam(DISTRIBUTIONS),
  audience: enumArrayParam(AUDIENCES),
  query: queryParam(),
});

const BuildsEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PackageIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No builds yet</EmptyTitle>
        <EmptyDescription>
          Build and upload a binary from your app repo — it shows up here with its runtime
          compatibility.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <CliCommandBlock commands={["better-update build"]} />
      </EmptyContent>
    </Empty>
  </Card>
);

const BuildsSkeleton = () => (
  <>
    <PageHeader size="sub" title="Builds" />
    <FilterBarSkeleton hasSearch selectCount={3} />
    <TableSkeleton columns={7} rows={6} />
  </>
);

const isBuildDistribution = (value: string | undefined): value is BuildDistribution =>
  value !== undefined && (DISTRIBUTIONS as readonly string[]).includes(value);

const BuildsContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug: projectSlug } = project;
  const routeNavigate = Route.useNavigate();

  const { page, sort, platform, distribution, audience, query: urlQuery } = Route.useSearch();
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

  const handlePlatformChange = (next: readonly ("ios" | "android")[]) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, platform: [...next], page: 1 }),
      }),
    );
  };

  const handleDistributionChange = (value: readonly string[]) => {
    const next = value.filter(isBuildDistribution);
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, distribution: next, page: 1 }),
      }),
    );
  };

  const handleAudienceChange = (next: readonly BuildAudience[]) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, audience: [...next], page: 1 }),
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
          platform: [],
          distribution: [],
          audience: [],
          query: "",
          page: 1,
        }),
      }),
    );
  };

  // platform/audience are two-value enums, so "both selected" ≡ no filter and
  // the API keeps its single-value param; distribution is a true multi filter.
  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...buildsQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(platform.length === 1 ? { platform: platform[0] } : {}),
      ...(distribution.length > 0 ? { distribution } : {}),
      ...(audience.length === 1 ? { audience: audience[0] } : {}),
      ...(urlQuery ? { query: urlQuery } : {}),
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  const { data: matrix } = useSuspenseQuery(buildCompatibilityMatrixQueryOptions(orgId, projectId));

  const columns = useMemo(() => buildBuildsColumns(orgId, projectId), [orgId, projectId]);
  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    // Secondary numeric columns stay opt-in (View options) so the table fits
    // without horizontal scroll.
    initialState: { columnVisibility: { buildNumber: false, size: false } },
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader size="sub" title="Builds" />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <>
            <FilterBarSkeleton hasSearch selectCount={3} />
            <TableSkeleton columns={7} rows={6} />
          </>
        )}
      </div>
    );
  }

  const filtersActive =
    platform.length > 0 || distribution.length > 0 || audience.length > 0 || urlQuery.length > 0;

  if (data.total === 0 && !filtersActive && searchDraft.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader size="sub" title="Builds" />
        <BuildsEmptyState />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );
  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "build")}${
    filtersActive ? " (filtered)" : ""
  }`;

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader size="sub" title="Builds" />
      <CompatibilityMatrix
        builds={tableData}
        matrix={matrix}
        missingRuntimeVersions={matrix.missingRuntimeVersions}
      />
      <DataTableToolbar
        search={{
          value: searchDraft,
          onChange: handleSearchChange,
          placeholder: "Search by message, commit or branch…",
        }}
        isFiltered={filtersActive || searchDraft.length > 0}
        onReset={handleReset}
        actions={<DataTableViewOptions table={table} />}
      >
        <BuildsFilterBar
          platformFilter={platform}
          distributionFilter={distribution}
          audienceFilter={audience}
          onPlatformFilter={handlePlatformChange}
          onDistributionFilter={handleDistributionChange}
          onAudienceFilter={handleAudienceChange}
        />
      </DataTableToolbar>
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        countLabel={countLabel}
        safePage={safePage}
        totalPages={totalPages}
        onPageChange={onPageChange}
        emptyMessage="No builds match your filters."
        onRowClick={async (build) => {
          await routeNavigate({
            to: "/projects/$projectSlug/builds/$buildId",
            params: { projectSlug, buildId: build.id },
          });
        }}
      />
    </div>
  );
};

const BuildsPage = () => (
  <Suspense fallback={<BuildsSkeleton />}>
    <BuildsContent />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/builds/")({
  validateSearch: zodValidator(buildsSearchSchema),
  component: BuildsPage,
});
