import {
  buildCompatibilityMatrixQueryOptions,
  buildsQueryOptions,
} from "@better-update/api-client/react";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { keepPreviousData, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { PackageIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type {
  BuildAudience,
  BuildDistribution,
  BuildSortColumn,
} from "@better-update/api-client/react";
import type { ChangeEvent } from "react";

import { CompatibilityMatrix } from "../-compatibility-matrix";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  fireAndForget,
  optionalEnumParam,
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
  platform: optionalEnumParam(PLATFORMS),
  distribution: optionalEnumParam(DISTRIBUTIONS),
  audience: optionalEnumParam(AUDIENCES),
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
        <EmptyDescription>Upload your first build using the CLI to get started.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const BuildsSkeleton = () => (
  <>
    <div className="flex items-center justify-between gap-2">
      <ProjectSubpageHeader title="Builds" />
    </div>
    <TableSkeleton columns={9} rows={6} />
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

  const handlePlatformChange = (next: "ios" | "android" | undefined) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, platform: next, page: 1 }),
      }),
    );
  };

  const handleDistributionChange = (value: string | undefined) => {
    const next = isBuildDistribution(value) ? value : undefined;
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, distribution: next, page: 1 }),
      }),
    );
  };

  const handleAudienceChange = (next: BuildAudience | undefined) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, audience: next, page: 1 }),
      }),
    );
  };

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...buildsQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(platform ? { platform } : {}),
      ...(distribution ? { distribution } : {}),
      ...(audience ? { audience } : {}),
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
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const filterControls = (
    <BuildsFilterBar
      platformFilter={platform}
      distributionFilter={distribution}
      audienceFilter={audience}
      onPlatformFilter={handlePlatformChange}
      onDistributionFilter={handleDistributionChange}
      onAudienceFilter={handleAudienceChange}
    />
  );

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <ProjectSubpageHeader title="Builds" />
          <div className="flex flex-wrap items-center gap-2">{filterControls}</div>
        </div>
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={9} rows={6} />
        )}
      </div>
    );
  }

  const filtersActive =
    Boolean(platform) || Boolean(distribution) || Boolean(audience) || urlQuery.length > 0;

  if (data.total === 0 && !filtersActive && searchDraft.length === 0) {
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
    page,
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
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search builds"
          placeholder="Search by message, commit or branch…"
          type="search"
          value={searchDraft}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            handleSearchChange(event.target.value);
          }}
        />
        {isPlaceholderData ? (
          <InputGroupAddon align="inline-end">
            <Spinner />
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {data.total === 0 ? (
        <Card>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon strokeWidth={1.5} />
              </EmptyMedia>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>No builds match your filters.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : (
        <DataTableView
          table={table}
          columnsCount={columns.length}
          isPlaceholderData={isPlaceholderData}
          countLabel={countLabel}
          safePage={safePage}
          totalPages={totalPages}
          onPageChange={onPageChange}
          onRowClick={async (build) => {
            await routeNavigate({
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
  validateSearch: zodValidator(buildsSearchSchema),
  component: BuildsPage,
});
