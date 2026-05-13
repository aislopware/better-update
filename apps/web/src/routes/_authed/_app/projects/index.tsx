import { projectsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Frame } from "@better-update/ui/components/ui/frame";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { cn } from "@better-update/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  Loader2Icon,
  SearchIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { ProjectItem, ProjectSort, ProjectSortColumn } from "@better-update/api-client/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { EntityAvatar } from "../../../../lib/entity-avatar";
import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { pluralize } from "../../../../lib/pluralize";
import { CreateProjectDialog } from "./-create-dialog";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const DEFAULT_SORTING: SortingState = [{ id: "lastActivityAt", desc: true }];

const SORT_COLUMNS = [
  "name",
  "lastActivityAt",
  "createdAt",
  "branchCount",
  "channelCount",
  "updateCount",
] as const satisfies readonly ProjectSortColumn[];

const toSortColumn = (id: string): ProjectSortColumn | undefined =>
  SORT_COLUMNS.find((column) => column === id);

const toApiSort = (sorting: SortingState): ProjectSort | undefined => {
  const [first] = sorting;
  if (!first) {
    return undefined;
  }
  const column = toSortColumn(first.id);
  if (!column) {
    return undefined;
  }
  return first.desc ? `-${column}` : column;
};

const ARIA_SORT_MAP = { asc: "ascending", desc: "descending" } as const;
const toAriaSort = (direction: false | "asc" | "desc"): "ascending" | "descending" | "none" =>
  direction === false ? "none" : ARIA_SORT_MAP[direction];

const EmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <FolderIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No projects yet</EmptyTitle>
      <EmptyDescription>Create your first project to start publishing updates.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const formatShortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const getActivityDotColor = (lastActivityAt: string): string => {
  const days = (Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000;
  if (days < 7) {
    return "bg-emerald-500";
  }
  if (days < 30) {
    return "bg-amber-500";
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
    Active {formatRelativeTime(project.lastActivityAt)}
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
    cell: ({ row }) => formatShortDate(row.original.createdAt),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
];

interface ColumnMeta {
  readonly align?: "right";
  readonly muted?: boolean;
}

const cellAlignClass = (meta: ColumnMeta | undefined): string => {
  const classes: string[] = [];
  if (meta?.align === "right") {
    classes.push("text-right tabular-nums");
  }
  if (meta?.muted) {
    classes.push("text-muted-foreground");
  }
  return classes.join(" ");
};

interface PaginationControlsProps {
  readonly countLabel: string;
  readonly safePage: number;
  readonly totalPages: number;
  readonly isPlaceholderData: boolean;
  readonly onChange: (next: number) => void;
}

const PaginationControls = ({
  countLabel,
  safePage,
  totalPages,
  isPlaceholderData,
  onChange,
}: PaginationControlsProps) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground text-xs tabular-nums">{countLabel}</span>
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-xs"
        disabled={safePage === 1 || isPlaceholderData}
        onClick={() => {
          onChange(safePage - 1);
        }}
        aria-label="Previous page"
      >
        <ChevronLeftIcon strokeWidth={2} />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        disabled={safePage >= totalPages || isPlaceholderData}
        onClick={() => {
          onChange(safePage + 1);
        }}
        aria-label="Next page"
      >
        <ChevronRightIcon strokeWidth={2} />
      </Button>
    </div>
  </div>
);

const SortIcon = ({ direction }: { direction: false | "asc" | "desc" }) => {
  if (direction === "asc") {
    return <ArrowUpIcon strokeWidth={2} className="size-3.5" />;
  }
  if (direction === "desc") {
    return <ArrowDownIcon strokeWidth={2} className="size-3.5" />;
  }
  return null;
};

const computePagination = (total: number, itemCount: number, page: number) => {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const fromIndex = itemCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const toIndex = (safePage - 1) * PAGE_SIZE + itemCount;
  return { totalPages, safePage, fromIndex, toIndex };
};

const Projects = () => {
  const { activeOrg } = Route.useRouteContext();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [page, setPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleSortingChange = (updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setSorting((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next.length === 0 ? DEFAULT_SORTING : next.slice(0, 1);
    });
    setPage(1);
  };

  const handlePageChange = (next: number) => {
    setPage(next);
  };

  const apiSort = toApiSort(sorting);
  const { data, isPlaceholderData, isLoading } = useQuery({
    ...projectsQueryOptions(activeOrg.id, {
      page,
      limit: PAGE_SIZE,
      ...(debouncedQuery ? { query: debouncedQuery } : {}),
      ...(apiSort ? { sort: apiSort } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  const tableData = useMemo(() => [...(data?.items ?? [])], [data?.items]);

  const table = useReactTable({
    data: tableData,
    columns: [...columns],
    state: { sorting },
    onSortingChange: handleSortingChange,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
  });

  const createCta = useMemo(() => <CreateProjectDialog orgId={activeOrg.id} />, [activeOrg.id]);

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="Projects"
          description="Manage your over-the-air update projects."
          actions={createCta}
        />
        <TableSkeleton columns={6} rows={6} />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  const showsFilteredEmpty = data.total === 0 && debouncedQuery.length > 0;
  const showsGlobalEmpty = data.total === 0 && debouncedQuery.length === 0 && search.length === 0;

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
    debouncedQuery ? " (filtered)" : ""
  }`;

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Projects"
        description="Manage your over-the-air update projects."
        actions={createCta}
      />
      <div className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search projects…"
            value={search}
            onChange={(event) => {
              handleSearchChange(event.target.value);
            }}
            className="pr-8 pl-8"
          />
          {isPlaceholderData ? (
            <Loader2Icon className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 z-10 size-4 -translate-y-1/2 animate-spin" />
          ) : null}
        </div>
        {showsFilteredEmpty ? (
          <p className="text-muted-foreground rounded-xl border border-dashed py-10 text-center text-sm">
            No projects match your search.
          </p>
        ) : (
          <Frame
            className={
              isPlaceholderData ? "opacity-60 transition-opacity" : "opacity-100 transition-opacity"
            }
          >
            <Table variant="card">
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => {
                      const meta = header.column.columnDef.meta as ColumnMeta | undefined;
                      const sortDir = header.column.getIsSorted();
                      const canSort = header.column.getCanSort();
                      return (
                        <TableHead
                          key={header.id}
                          className={cn(
                            meta?.align === "right" ? "text-right" : "",
                            canSort
                              ? "hover:text-foreground cursor-pointer transition-colors select-none"
                              : "",
                          )}
                          aria-sort={toAriaSort(sortDir)}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        >
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5",
                              meta?.align === "right" ? "justify-end" : "",
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {canSort ? <SortIcon direction={sortDir} /> : null}
                          </span>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={async () => {
                      await navigate({
                        to: "/projects/$projectSlug",
                        params: { projectSlug: row.original.slug },
                      });
                    }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
                      return (
                        <TableCell key={cell.id} className={cellAlignClass(meta)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <PaginationControls
                      countLabel={countLabel}
                      safePage={safePage}
                      totalPages={totalPages}
                      isPlaceholderData={isPlaceholderData}
                      onChange={handlePageChange}
                    />
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Frame>
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  component: Projects,
});
