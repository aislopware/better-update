import { branchesQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Frame } from "@better-update/ui/components/ui/frame";
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
import { createFileRoute } from "@tanstack/react-router";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GitBranchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { BranchItem, BranchSort, BranchSortColumn } from "@better-update/api-client/react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";

import { CreateBranchDialog } from "../-create-branch-dialog";
import { DeleteBranchDialog } from "../-delete-branch-dialog";
import { ProjectSubpageHeader } from "../-project-subpage-header";
import { RenameBranchDialog } from "../-rename-branch-dialog";
import { TableSkeleton } from "../../../../../../components/skeletons";
import { formatRelativeTime } from "../../../../../../lib/format-relative-time";
import { pluralize } from "../../../../../../lib/pluralize";

const PAGE_SIZE = 50;

const DEFAULT_SORTING: SortingState = [{ id: "createdAt", desc: true }];

const SORT_COLUMNS = [
  "name",
  "createdAt",
  "updateCount",
] as const satisfies readonly BranchSortColumn[];

const toSortColumn = (id: string): BranchSortColumn | undefined =>
  SORT_COLUMNS.find((column) => column === id);

const toApiSort = (sorting: SortingState): BranchSort | undefined => {
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

const formatShortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

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

const BranchesEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <GitBranchIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No branches yet</EmptyTitle>
      <EmptyDescription>Create your first branch to start managing deployments.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

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

const BranchActions = ({
  branch,
  orgId,
  projectId,
}: {
  branch: BranchItem;
  orgId: string;
  projectId: string;
}) => (
  <div className="flex items-center justify-end gap-1">
    <RenameBranchDialog branch={branch} orgId={orgId} projectId={projectId} />
    <DeleteBranchDialog branch={branch} orgId={orgId} projectId={projectId} />
  </div>
);

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

const buildColumns = (orgId: string, projectId: string): readonly ColumnDef<BranchItem>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: "Branch",
    cell: ({ row }) => (
      <div className="flex items-center gap-2 font-medium">
        <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-4" />
        {row.original.name}
      </div>
    ),
    enableSorting: true,
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
    cell: ({ row }) => (
      <span title={formatShortDate(row.original.createdAt)}>
        {formatRelativeTime(row.original.createdAt)}
      </span>
    ),
    enableSorting: true,
    meta: { align: "right", muted: true },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <BranchActions branch={row.original} orgId={orgId} projectId={projectId} />,
    enableSorting: false,
    meta: { align: "right" },
  },
];

const BranchesPage = () => {
  const { activeOrg, project } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const projectId = project.id;

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [page, setPage] = useState(1);

  const handleSortingChange = (updater: SortingState | ((prev: SortingState) => SortingState)) => {
    setSorting((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next.length === 0 ? DEFAULT_SORTING : next.slice(0, 1);
    });
    setPage(1);
  };

  const apiSort = toApiSort(sorting);
  const { data, isPlaceholderData, isLoading } = useQuery({
    ...branchesQueryOptions(orgId, projectId, {
      page,
      limit: PAGE_SIZE,
      ...(apiSort ? { sort: apiSort } : {}),
    }),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(() => buildColumns(orgId, projectId), [orgId, projectId]);
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

  const createCta = useMemo(
    () => <CreateBranchDialog orgId={orgId} projectId={projectId} />,
    [orgId, projectId],
  );

  if (isLoading || data === undefined) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Branches" />
          {createCta}
        </div>
        <TableSkeleton columns={4} rows={5} />
      </div>
    );
  }

  const { totalPages, safePage, fromIndex, toIndex } = computePagination(
    data.total,
    data.items.length,
    page,
  );

  if (data.total === 0) {
    return (
      <div className="flex w-full flex-col gap-4">
        <div className="flex items-center justify-between">
          <ProjectSubpageHeader title="Branches" />
          {createCta}
        </div>
        <BranchesEmptyState />
      </div>
    );
  }

  const countLabel = `${fromIndex}–${toIndex} of ${data.total} ${pluralize(data.total, "branch", "branches")}`;

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <ProjectSubpageHeader title="Branches" />
        {createCta}
      </div>
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
              <TableRow key={row.id}>
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
                  onChange={setPage}
                />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Frame>
    </div>
  );
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/branches/")({
  component: BranchesPage,
});
