import { projectsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import { DateRangePicker } from "@better-update/ui/components/ui/date-range-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@better-update/ui/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { CheckIcon, FolderIcon, SearchIcon, SlidersHorizontalIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectItem } from "@better-update/api-client/react";
import type {
  ColumnDef,
  ColumnFiltersState,
  FilterFn,
  SortingState,
  Table as TableInstance,
} from "@tanstack/react-table";
import type { DateRange } from "react-day-picker";

import { EntityAvatar } from "../../../../lib/entity-avatar";
import { CreateProjectDialog } from "./-create-dialog";

type SortId = "lastActivityAt" | "name";

const DEFAULT_SORTING: SortingState = [{ id: "lastActivityAt", desc: true }];

const isSortId = (value: string): value is SortId => value === "lastActivityAt" || value === "name";

const isDateRange = (value: unknown): value is DateRange =>
  typeof value === "object" && value !== null && ("from" in value || "to" in value);

const formatRelativeTime = (dateString: string): string => {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffSec = Math.floor((now - date) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffHr < 24) {
    return `${diffHr}h ago`;
  }
  if (diffDay < 30) {
    return `${diffDay}d ago`;
  }
  return new Date(dateString).toLocaleDateString();
};

const nameSlugFilter: FilterFn<ProjectItem> = (row, _columnId, rawValue) => {
  const query = String(rawValue).trim().toLowerCase();
  if (!query) {
    return true;
  }
  const name = row.original.name.toLowerCase();
  const slug = row.original.slug.toLowerCase();
  return name.includes(query) || slug.includes(query);
};

const createdAtRangeFilter: FilterFn<ProjectItem> = (row, columnId, rawValue) => {
  if (!isDateRange(rawValue)) {
    return true;
  }
  const { from, to } = rawValue;
  if (!from && !to) {
    return true;
  }
  const ts = new Date(row.getValue<string>(columnId)).getTime();
  if (from) {
    const fromTs = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
    if (ts < fromTs) {
      return false;
    }
  }
  if (to) {
    const toTs = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59).getTime();
    if (ts > toTs) {
      return false;
    }
  }
  return true;
};

const columns: ColumnDef<ProjectItem>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const project = row.original;
      return (
        <Link
          to="/projects/$projectSlug"
          params={{ projectSlug: project.slug }}
          className="flex items-center gap-2 font-medium"
        >
          <EntityAvatar name={project.name} size="sm" shape="square" />
          {project.name}
        </Link>
      );
    },
  },
  {
    accessorKey: "slug",
    header: "Slug",
    cell: ({ row }) => (
      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{row.original.slug}</code>
    ),
  },
  {
    accessorKey: "lastActivityAt",
    header: "Last activity",
    cell: ({ row }) => (
      <span className="text-muted-foreground text-sm">
        {formatRelativeTime(row.original.lastActivityAt)}
      </span>
    ),
    sortingFn: "datetime",
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => (
      <Badge variant="outline">{new Date(row.original.createdAt).toLocaleDateString()}</Badge>
    ),
    sortingFn: "datetime",
    filterFn: createdAtRangeFilter,
  },
];

const SORT_OPTIONS: readonly { value: SortId; label: string }[] = [
  { value: "lastActivityAt", label: "Activity" },
  { value: "name", label: "Name" },
];

const sortTriggerButton = (
  <Button variant="outline" size="sm">
    <SlidersHorizontalIcon strokeWidth={2} data-icon="inline-start" />
    <span>Sort</span>
  </Button>
);

const SortDropdown = ({ value, onChange }: { value: SortId; onChange: (next: SortId) => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger render={sortTriggerButton} />
    <DropdownMenuContent align="end" className="w-44">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => {
              onChange(option.value);
            }}
          >
            <span className="flex-1">{option.label}</span>
            {option.value === value ? <CheckIcon strokeWidth={2} className="text-primary" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const EmptyState = () => (
  <Empty className="border">
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <FolderIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No projects yet</EmptyTitle>
      <EmptyDescription>Create your first project to start publishing updates.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const ProjectsTable = ({ table }: { table: TableInstance<ProjectItem> }) => {
  const { rows } = table.getRowModel();
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <Table className="[&_td]:px-4 [&_td]:py-3 [&_th]:h-9 [&_th]:px-4">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-muted-foreground text-xs font-medium">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground h-24 text-center"
                >
                  No projects match your filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

const pluralProjects = (count: number) => (count === 1 ? "project" : "projects");

const Projects = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { data } = useSuspenseQuery(projectsQueryOptions(orgId, 1, 1000));

  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const dateRange = useMemo<DateRange | undefined>(() => {
    const entry = columnFilters.find((filter) => filter.id === "createdAt");
    return isDateRange(entry?.value) ? entry.value : undefined;
  }, [columnFilters]);

  const handleDateRangeChange = (next: DateRange | undefined) => {
    setColumnFilters((previous) => {
      const rest = previous.filter((filter) => filter.id !== "createdAt");
      if (!next?.from && !next?.to) {
        return rest;
      }
      return [...rest, { id: "createdAt", value: next }];
    });
  };

  const firstSortId = sorting[0]?.id;
  const sortId: SortId = firstSortId && isSortId(firstSortId) ? firstSortId : "lastActivityAt";
  const handleSortChange = (next: SortId) => {
    setSorting((previous) => {
      if (previous[0]?.id === next) {
        return previous;
      }
      return [{ id: next, desc: next === "lastActivityAt" }];
    });
  };

  const tableData = useMemo<ProjectItem[]>(() => [...data.items], [data.items]);

  const table = useReactTable<ProjectItem>({
    data: tableData,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    globalFilterFn: nameSlugFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const totalCount = data.items.length;
  const filteredCount = table.getFilteredRowModel().rows.length;
  const createCta = useMemo(() => <CreateProjectDialog orgId={orgId} />, [orgId]);

  if (totalCount === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex justify-end">{createCta}</div>
        <EmptyState />
      </div>
    );
  }

  const countLabel =
    filteredCount === totalCount
      ? `${totalCount} ${pluralProjects(totalCount)}`
      : `${filteredCount} of ${totalCount} ${pluralProjects(totalCount)}`;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search projects…"
            value={globalFilter}
            onChange={(event) => {
              setGlobalFilter(event.target.value);
            }}
            className="pl-8"
          />
        </div>
        <DateRangePicker
          value={dateRange}
          onChange={handleDateRangeChange}
          placeholder="Created date"
        />
        <SortDropdown value={sortId} onChange={handleSortChange} />
        <div className="ml-auto">{createCta}</div>
      </div>
      <ProjectsTable table={table} />
      <p className="text-muted-foreground text-sm">{countLabel}</p>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  component: Projects,
});
