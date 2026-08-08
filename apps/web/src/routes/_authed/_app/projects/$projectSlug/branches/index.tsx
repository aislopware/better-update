import { branchesQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/badge";
import { Empty } from "@better-update/ui/components/empty";
import { GitBranchIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { useMemo } from "react";
import { z } from "zod";

import type { BranchItem, BranchSortColumn } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { CreateBranchDialog } from "../-create-branch-dialog";
import { PageHeader } from "../../../../../../components/page-header";
import { QueryErrorState } from "../../../../../../components/query-error-state";
import { TableSkeleton } from "../../../../../../components/skeletons";
import {
  DataTableToolbar,
  DataTableView,
  PAGE_SIZE,
  computePagination,
  fireAndForget,
  pageParam,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../../../../lib/data-table";
import { pluralize } from "../../../../../../lib/pluralize";
import { RelativeTime } from "../../../../../../lib/relative-time";
import { BranchRowActions } from "./-branch-row-actions";

const SEARCH_DEBOUNCE_MS = 300;

const SORT_COLUMNS = [
  "name",
  "createdAt",
  "updateCount",
] as const satisfies readonly BranchSortColumn[];

const DEFAULT_SORT = "-createdAt" as const;

const branchesSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
});

const BranchesEmptyState = () => (
  <Empty
    icon={<GitBranchIcon className="text-kumo-inactive size-10" />}
    title="No branches yet"
    description="Create your first branch to start managing deployments."
  />
);

/**
 * A branch is only reachable through a channel, so the channels that serve it
 * belong under its name — the row used to leave that half of the table blank
 * and left the reader to open every branch to find out which ones were live.
 */
const BranchNameCell = ({ branch }: { branch: BranchItem }) => (
  <div className="flex min-w-0 flex-col gap-0.5">
    <div className="flex min-w-0 items-center gap-2 font-medium">
      <GitBranchIcon weight="bold" className="text-kumo-subtle size-4 shrink-0" />
      <span className="truncate">{branch.name}</span>
      {branch.isBuiltin ? (
        <Badge variant="outline" className="text-kumo-subtle">
          Built-in
        </Badge>
      ) : null}
    </div>
    <span className="text-kumo-subtle truncate pl-6 text-xs">
      {branch.channelNames.length > 0
        ? `Served by ${branch.channelNames.join(", ")}`
        : "No channel points here"}
    </span>
  </div>
);

const buildColumns = (orgId: string, projectId: string): readonly ColumnDef<BranchItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Branch",
    cell: ({ row }) => <BranchNameCell branch={row.original} />,
    enableSorting: true,
    meta: { primary: true },
  },
  {
    id: "updateCount",
    accessorKey: "updateCount",
    header: "Updates",
    cell: ({ row }) => <span className="tabular-nums">{row.original.updateCount}</span>,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "latestUpdateAt",
    header: "Last publish",
    // What a branch is doing now, which its creation date never said: a branch
    // with updates but none in months is the one worth looking at.
    cell: ({ row }) =>
      row.original.latestUpdateAt === null ? (
        <span className="text-kumo-subtle">Never</span>
      ) : (
        <RelativeTime value={row.original.latestUpdateAt} />
      ),
    enableSorting: false,
    meta: { align: "right", muted: true },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <BranchRowActions branch={row.original} orgId={orgId} projectId={projectId} />
    ),
    enableSorting: false,
    meta: { align: "right", stopRowClick: true },
  },
];

const BranchesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;

  const { page, sort, query: urlQuery } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { sorting, apiSort, onSortingChange, onPageChange } = useDataTableSearch({
    sortColumns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    sort,
    navigate,
  });

  const { draft: searchDraft, setDraft: handleSearchChange } = useDebouncedSearch({
    initial: urlQuery,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      fireAndForget(
        navigate({
          to: ".",
          search: (prev) => ({ ...prev, query: value, page: 1 }),
          replace: true,
        }),
      );
    },
  });

  const handleReset = () => {
    handleSearchChange("");
    fireAndForget(
      navigate({
        to: ".",
        search: (prev) => ({ ...prev, query: "", page: 1 }),
      }),
    );
  };

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...branchesQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(urlQuery ? { query: urlQuery } : {}),
      sort: apiSort,
    }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(() => buildColumns(orgId, projectId), [orgId, projectId]);
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

  const createCta = <CreateBranchDialog orgId={orgId} projectId={projectId} />;

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title="Branches"
          description="Where updates land when published. A channel points at a branch to serve it."
          actions={createCta}
        />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={5} rows={5} />
        )}
      </div>
    );
  }

  const { safePage } = computePagination(data.total, page);

  const showsGlobalEmpty = data.total === 0 && urlQuery.length === 0 && searchDraft.length === 0;

  if (showsGlobalEmpty) {
    return (
      <div className="flex w-full flex-col gap-4">
        <PageHeader
          title="Branches"
          description="Where updates land when published. A channel points at a branch to serve it."
          actions={createCta}
        />
        <BranchesEmptyState />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Branches"
        description="Where updates land when published. A channel points at a branch to serve it."
        actions={createCta}
      />
      <DataTableToolbar
        search={{
          value: searchDraft,
          onChange: handleSearchChange,
          placeholder: "Search branches…",
        }}
        isFiltered={urlQuery.length > 0 || searchDraft.length > 0}
        onReset={handleReset}
      />
      <DataTableView
        table={table}
        columnsCount={columns.length}
        isPlaceholderData={isPlaceholderData}
        pagination={{
          page: safePage,
          perPage: PAGE_SIZE,
          totalCount: data.total,
          entity: pluralize(data.total, "branch", "branches"),
          isFiltered: urlQuery.length > 0,
          onChange: onPageChange,
        }}
        emptyMessage="No branches match your search."
      />
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/branches/")({
  validateSearch: zodValidator(branchesSearchSchema),
  component: BranchesPage,
});
