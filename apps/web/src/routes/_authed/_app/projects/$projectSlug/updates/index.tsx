import {
  branchesQueryOptions,
  channelsQueryOptions,
  updatesQueryOptions,
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
import { CloudUploadIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import type { UpdateSortColumn } from "@better-update/api-client/react";
import type { ChangeEvent } from "react";

import { CompareUpdatesDialog } from "../-compare-updates-dialog";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
  fireAndForget,
  optionalEnumParam,
  optionalStringParam,
  pageParam,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../../queries/constants";
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
  platform: optionalEnumParam(PLATFORMS),
  branchId: optionalStringParam(),
  query: queryParam(),
});

const UpdatesEmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudUploadIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No updates yet</EmptyTitle>
        <EmptyDescription>Publish your first update using the CLI to see it here.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const UpdatesSkeleton = () => (
  <>
    <div className="flex items-center justify-between gap-2">
      <ProjectSubpageHeader title="Updates" />
    </div>
    <TableSkeleton columns={8} rows={6} />
  </>
);

interface UseUpdatesDataArgs {
  readonly orgId: string;
  readonly projectId: string;
  readonly slug: string;
  readonly page: number;
  readonly apiSort: (typeof SORT_COLUMNS)[number] | `-${(typeof SORT_COLUMNS)[number]}`;
  readonly branchId: string | undefined;
  readonly platform: "ios" | "android" | undefined;
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
  query,
}: UseUpdatesDataArgs) => {
  const updatesQuery = useQuery({
    ...updatesQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(branchId ? { branchId } : {}),
      ...(platform ? { platform } : {}),
      ...(query ? { query } : {}),
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  const { data: branchesData } = useSuspenseQuery(
    branchesQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const { data: channelsData } = useSuspenseQuery(
    channelsQueryOptions(orgId, projectId, { limit: DROPDOWN_FETCH_LIMIT }),
  );
  const branches = branchesData.items;
  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const columns = useMemo(
    () => buildUpdateColumns(branchNames, channelsData.items, slug, orgId, projectId),
    [branchNames, channelsData.items, slug, orgId, projectId],
  );

  return { updatesQuery, branches, columns };
};

const UpdatesContent = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { id: projectId, slug } = project;
  const routeNavigate = Route.useNavigate();

  const { page, sort, platform, branchId, query: urlQuery } = Route.useSearch();
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

  const handleBranchFilter = (next: string | undefined) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, branchId: next, page: 1 }),
      }),
    );
  };

  const handlePlatformFilter = (next: "ios" | "android" | undefined) => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, platform: next, page: 1 }),
      }),
    );
  };

  const { updatesQuery, branches, columns } = useUpdatesData({
    orgId,
    projectId,
    slug,
    page,
    apiSort,
    branchId,
    platform,
    query: urlQuery,
  });

  const { data, error, isPlaceholderData, isLoading, refetch } = updatesQuery;
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

  const branchFilterLabels: Record<string, string> = {
    all: "All branches",
    ...Object.fromEntries(branches.map((branch) => [branch.id, branch.name])),
  };
  const filterControls = (
    <UpdatesFilterBar
      branches={branches}
      branchFilterLabels={branchFilterLabels}
      branchFilter={branchId}
      platformFilter={platform}
      onBranchFilter={handleBranchFilter}
      onPlatformFilter={handlePlatformFilter}
    />
  );

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <ProjectSubpageHeader title="Updates" />
          <div className="flex flex-wrap items-center gap-2">
            {filterControls}
            <CompareUpdatesDialog orgId={orgId} projectId={projectId} />
          </div>
        </div>
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={8} rows={6} />
        )}
      </div>
    );
  }

  const filtersActive = Boolean(branchId) || Boolean(platform) || urlQuery.length > 0;

  if (data.total === 0 && !filtersActive && searchDraft.length === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <ProjectSubpageHeader title="Updates" />
          <div className="flex flex-wrap items-center gap-2">
            {filterControls}
            <CompareUpdatesDialog orgId={orgId} projectId={projectId} />
          </div>
        </div>
        <UpdatesEmptyState />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
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
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search updates"
          placeholder="Search by message or commit…"
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
              <EmptyDescription>No updates match your filters.</EmptyDescription>
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
          onRowClick={async (update) => {
            await routeNavigate({
              to: "/projects/$projectSlug/updates/$updateId",
              params: { projectSlug: slug, updateId: update.id },
            });
          }}
        />
      )}
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
