import { projectsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { differenceInDays } from "date-fns";
import { ArchiveIcon, FolderIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { ProjectItem, ProjectSortColumn } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";

import { PageHeader } from "../../../../components/page-header";
import { QueryErrorState } from "../../../../components/query-error-state";
import { TableSkeleton } from "../../../../components/skeletons";
import { StatusDot } from "../../../../components/status-dot";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  DataTableView,
  PAGE_SIZE,
  computePagination,
  enumArrayParam,
  fireAndForget,
  pageParam,
  queryParam,
  sortParam,
  useDataTableSearch,
  useDebouncedSearch,
} from "../../../../lib/data-table";
import { EntityAvatar } from "../../../../lib/entity-avatar";
import { pluralize } from "../../../../lib/pluralize";
import { RelativeTime } from "../../../../lib/relative-time";
import { CreateProjectDialog } from "./-create-dialog";

const SEARCH_DEBOUNCE_MS = 300;

const SORT_COLUMNS = [
  "name",
  "lastActivityAt",
  "createdAt",
  "branchCount",
  "channelCount",
  "updateCount",
] as const satisfies readonly ProjectSortColumn[];

const DEFAULT_SORT = "-lastActivityAt" as const;

const STATUS_VALUES = ["active", "archived"] as const;
type StatusFilter = (typeof STATUS_VALUES)[number];

// An empty (or full) chip selection means "all"; the URL default stays
// ["active"] so the page opens on active projects.
const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
] as const;

const DEFAULT_STATUS = ["active"] as const satisfies readonly StatusFilter[];

const isStatusFilter = (value: unknown): value is StatusFilter =>
  (STATUS_VALUES as readonly unknown[]).includes(value);

const isDefaultStatus = (status: readonly StatusFilter[]): boolean =>
  status.length === 1 && status[0] === "active";

const projectsSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
  status: enumArrayParam(STATUS_VALUES, DEFAULT_STATUS),
});

const EmptyState = () => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderIcon strokeWidth={1.5} />
        </EmptyMedia>
        <EmptyTitle>No projects yet</EmptyTitle>
        <EmptyDescription>Create your first project to start publishing updates.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </Card>
);

const ProjectNameCell = ({ project }: { project: ProjectItem }) => (
  <Link
    to="/projects/$projectSlug"
    params={{ projectSlug: project.slug }}
    className="flex items-center gap-3 outline-none focus-visible:underline"
    onClick={(event) => {
      event.stopPropagation();
    }}
  >
    <EntityAvatar
      name={project.name}
      seed={project.slug}
      image={project.logoUrl}
      size="sm"
      shape="square"
    />
    <div className="flex min-w-0 flex-col">
      <span className="text-foreground truncate font-medium">{project.name}</span>
      <code className="text-muted-foreground truncate font-mono text-xs">/{project.slug}</code>
    </div>
  </Link>
);

const ACTIVE_WITHIN_DAYS = 7;
const STALE_AFTER_DAYS = 30;

// Health signal for the Activity column: green when the project shipped
// something this week, gray when it has gone quiet for over a month. The
// in-between band is the unremarkable default and stays dot-free — color is
// exception-only. Exported for tests.
export const activityTone = (lastActivityAt: string): "success" | "muted" | undefined => {
  const days = differenceInDays(new Date(), new Date(lastActivityAt));
  if (days < ACTIVE_WITHIN_DAYS) {
    return "success";
  }
  return days > STALE_AFTER_DAYS ? "muted" : undefined;
};

// Ongoing activity is the expected state — relative time, with a StatusDot only
// at the fresh/stale extremes. Only the archived exception keeps a badge.
// Exported for tests.
export const ActivityCell = ({ project }: { project: ProjectItem }) => {
  if (project.archivedAt) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <ArchiveIcon aria-hidden="true" className="size-3" />
        Archived <RelativeTime value={project.archivedAt} />
      </Badge>
    );
  }
  const tone = activityTone(project.lastActivityAt);
  const time = (
    <RelativeTime value={project.lastActivityAt} className="text-muted-foreground text-sm" />
  );
  return tone ? <StatusDot tone={tone}>{time}</StatusDot> : time;
};

// One secondary cell for project shape — counts are context, not KPIs, so they
// share a column instead of claiming two numeric ones. Exported for tests.
export const StructureCell = ({ project }: { project: ProjectItem }) => (
  <span className="text-muted-foreground text-sm whitespace-nowrap">
    {project.branchCount} {pluralize(project.branchCount, "branch", "branches")}
    {" · "}
    {project.channelCount} {pluralize(project.channelCount, "channel")}
  </span>
);

const columns: readonly ColumnDef<ProjectItem>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Project",
    cell: ({ row }) => <ProjectNameCell project={row.original} />,
    enableSorting: true,
  },
  {
    id: "lastActivityAt",
    accessorKey: "lastActivityAt",
    header: "Activity",
    cell: ({ row }) => <ActivityCell project={row.original} />,
    enableSorting: true,
  },
  {
    // Combined secondary cell; sort by branches/channels stays reachable via
    // the URL `sort` param but is no longer a header affordance.
    id: "structure",
    header: "Structure",
    cell: ({ row }) => <StructureCell project={row.original} />,
    enableSorting: false,
  },
  {
    id: "updateCount",
    accessorKey: "updateCount",
    header: "Updates",
    cell: ({ row }) => row.original.updateCount,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
];

const Projects = () => {
  const { activeOrg } = Route.useRouteContext();
  const routeNavigate = Route.useNavigate();
  const { page, sort, query: urlQuery, status } = Route.useSearch();

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

  const { data, error, isPlaceholderData, isLoading, refetch } = useQuery({
    ...projectsQueryOptions(activeOrg.id, {
      page,
      limit: PAGE_SIZE,
      ...(urlQuery ? { query: urlQuery } : {}),
      sort: apiSort,
      // Both statuses selected ≡ "all" — the API keeps its tri-state param.
      status: status.length === 1 ? (status[0] ?? "all") : "all",
    }),
    placeholderData: keepPreviousData,
  });

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

  const createCta = <CreateProjectDialog orgId={activeOrg.id} />;

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="Projects"
          description="Manage your over-the-air update projects."
          actions={createCta}
        />
        {error ? (
          <QueryErrorState error={error} onRetry={refetch} />
        ) : (
          <TableSkeleton columns={5} rows={6} />
        )}
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  const isEmpty = data.total === 0;
  // Only the true "no projects at all" case (active filter, no search) gets the
  // create-your-first-project CTA. An empty archived/all view or empty search
  // keeps the toolbar so the user can change the filter.
  const showsGlobalEmpty =
    isEmpty && urlQuery.length === 0 && searchDraft.length === 0 && isDefaultStatus(status);

  if (showsGlobalEmpty) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="Projects"
          description="Manage your over-the-air update projects."
          actions={createCta}
        />
        <EmptyState />
      </div>
    );
  }

  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "project")}${
    urlQuery ? " (filtered)" : ""
  }`;

  const isFiltered = urlQuery.length > 0 || !isDefaultStatus(status);

  const handleStatusChange = (next: readonly string[]): void => {
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({
          ...prev,
          status: next.filter(isStatusFilter),
          page: 1,
        }),
        replace: true,
      }),
    );
  };

  const handleReset = (): void => {
    handleSearchChange("");
    fireAndForget(
      routeNavigate({
        to: ".",
        search: (prev) => ({ ...prev, query: "", status: [...DEFAULT_STATUS], page: 1 }),
        replace: true,
      }),
    );
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Manage your over-the-air update projects."
        actions={createCta}
      />
      <div className="flex flex-col gap-3">
        <DataTableToolbar
          search={{
            value: searchDraft,
            onChange: handleSearchChange,
            placeholder: "Search projects…",
          }}
          isFiltered={isFiltered}
          onReset={handleReset}
        >
          <DataTableFacetedFilter
            title="Status"
            options={STATUS_OPTIONS}
            selected={status}
            onChange={handleStatusChange}
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
          emptyMessage="No projects match your filters."
          onRowClick={async (project) => {
            await routeNavigate({
              to: "/projects/$projectSlug",
              params: { projectSlug: project.slug },
            });
          }}
        />
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  validateSearch: zodValidator(projectsSearchSchema),
  component: Projects,
});
