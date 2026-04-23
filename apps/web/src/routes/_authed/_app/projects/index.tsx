import { projectsQueryOptions } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  FolderIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectItem } from "@better-update/api-client/react";
import type {
  ColumnDef,
  FilterFn,
  SortingState,
  Table as TableInstance,
} from "@tanstack/react-table";

import { EntityAvatar } from "../../../../lib/entity-avatar";
import { formatRelativeTime } from "../../../../lib/format-relative-time";
import { pluralize } from "../../../../lib/pluralize";
import { CreateProjectDialog } from "./-create-dialog";

type SortId = "lastActivityAt" | "name";

const DEFAULT_SORTING: SortingState = [{ id: "lastActivityAt", desc: true }];

const isSortId = (value: string): value is SortId => value === "lastActivityAt" || value === "name";

const nameSlugFilter: FilterFn<ProjectItem> = (row, _columnId, rawValue) => {
  const query = String(rawValue).trim().toLowerCase();
  if (!query) {
    return true;
  }
  const name = row.original.name.toLowerCase();
  const slug = row.original.slug.toLowerCase();
  return name.includes(query) || slug.includes(query);
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
          <EntityAvatar name={project.name} seed={project.slug} size="sm" shape="square" />
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
  },
];

const SORT_LABELS: Record<SortId, string> = {
  lastActivityAt: "Activity",
  name: "Name",
};

const SORT_OPTIONS: readonly { value: SortId; label: string }[] = [
  { value: "lastActivityAt", label: SORT_LABELS.lastActivityAt },
  { value: "name", label: SORT_LABELS.name },
];

const sortTrigger = (
  <Button variant="outline" size="icon" aria-label="Sort">
    <SlidersHorizontalIcon strokeWidth={2} />
  </Button>
);

const SortDropdown = ({ value, onChange }: { value: SortId; onChange: (next: SortId) => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger render={sortTrigger} />
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
                {headerGroup.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className="text-muted-foreground text-xs font-medium"
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? (
                          <ArrowUpIcon strokeWidth={2} className="size-3.5" />
                        ) : null}
                        {sorted === "desc" ? (
                          <ArrowDownIcon strokeWidth={2} className="size-3.5" />
                        ) : null}
                      </span>
                    </TableHead>
                  );
                })}
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

const Projects = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { data } = useSuspenseQuery(projectsQueryOptions(orgId, 1, 1000));

  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);

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
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
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
      ? `${totalCount} ${pluralize(totalCount, "project")}`
      : `${filteredCount} of ${totalCount} ${pluralize(totalCount, "project")}`;

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1">
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
        <SortDropdown value={sortId} onChange={handleSortChange} />
        {createCta}
      </div>
      <ProjectsTable table={table} />
      <p className="text-muted-foreground text-sm">{countLabel}</p>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/")({
  component: Projects,
});
