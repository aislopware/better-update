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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { cn } from "@better-update/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { zodValidator } from "@tanstack/zod-adapter";
import { differenceInDays, parseISO } from "date-fns";
import { FolderIcon, SearchIcon, SearchXIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { ProjectItem, ProjectSortColumn } from "@better-update/api-client/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ChangeEvent } from "react";

import { PageHeader } from "../../../../components/page-header";
import { QueryErrorState } from "../../../../components/query-error-state";
import { TableSkeleton } from "../../../../components/skeletons";
import {
  DataTableView,
  PAGE_SIZE,
  computePagination,
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

const projectsSearchSchema = z.object({
  page: pageParam(),
  sort: sortParam(DEFAULT_SORT),
  query: queryParam(),
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

const getActivityDotColor = (lastActivityAt: string): string => {
  const days = differenceInDays(new Date(), parseISO(lastActivityAt));
  if (days < 7) {
    return "bg-success";
  }
  if (days < 30) {
    return "bg-warning";
  }
  return "bg-muted-foreground/64";
};

const ProjectNameCell = ({ project }: { project: ProjectItem }) => (
  <Link
    to="/projects/$projectSlug"
    params={{ projectSlug: project.slug }}
    className="flex items-center gap-3 outline-none focus-visible:underline"
    onClick={(event) => {
      event.stopPropagation();
    }}
  >
    <EntityAvatar name={project.name} seed={project.slug} size="sm" shape="square" />
    <div className="flex min-w-0 flex-col">
      <span className="text-foreground truncate font-medium">{project.name}</span>
      <code className="text-muted-foreground truncate font-mono text-xs">/{project.slug}</code>
    </div>
  </Link>
);

const ActivityCell = ({ project }: { project: ProjectItem }) => (
  <Badge variant="outline" className="gap-1.5">
    <span
      aria-hidden="true"
      className={cn("size-1.5 rounded-full", getActivityDotColor(project.lastActivityAt))}
    />
    Active <RelativeTime value={project.lastActivityAt} />
  </Badge>
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
    id: "branchCount",
    accessorKey: "branchCount",
    header: "Branches",
    cell: ({ row }) => row.original.branchCount,
    enableSorting: true,
    meta: { align: "right" },
  },
  {
    id: "channelCount",
    accessorKey: "channelCount",
    header: "Channels",
    cell: ({ row }) => row.original.channelCount,
    enableSorting: true,
    meta: { align: "right" },
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
  const { page, sort, query: urlQuery } = Route.useSearch();

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
          <TableSkeleton columns={6} rows={6} />
        )}
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  const showsFilteredEmpty = data.total === 0 && urlQuery.length > 0;
  const showsGlobalEmpty = data.total === 0 && urlQuery.length === 0 && searchDraft.length === 0;

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

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Manage your over-the-air update projects."
        actions={createCta}
      />
      <div className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search projects"
            placeholder="Search projects…"
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
        {showsFilteredEmpty ? (
          <Card>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon strokeWidth={1.5} />
                </EmptyMedia>
                <EmptyTitle>No projects match your search</EmptyTitle>
                <EmptyDescription>Try a different keyword or clear the search.</EmptyDescription>
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
            onRowClick={async (project) => {
              await routeNavigate({
                to: "/projects/$projectSlug",
                params: { projectSlug: project.slug },
              });
            }}
          />
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  validateSearch: zodValidator(projectsSearchSchema),
  component: Projects,
});
