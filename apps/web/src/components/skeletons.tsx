import { Card, CardContent, CardFooter, CardHeader } from "@better-update/ui/components/card";
import { Skeleton } from "@better-update/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

import { ListPanel, ListPanelFooter } from "../lib/data-table";

const repeat = (count: number) => Array.from({ length: count }, (_, index) => index);

const CELL_WIDTH_CLASSES = ["w-32", "w-20", "w-24", "w-16", "w-28", "w-20", "w-16"] as const;

const cellWidthClass = (index: number) =>
  CELL_WIDTH_CLASSES[index % CELL_WIDTH_CLASSES.length] ?? "w-20";

interface TableSkeletonProps {
  readonly columns?: number;
  readonly rows?: number;
  readonly hasFooter?: boolean;
  readonly className?: string;
}

/** The grid alone, for callers that already own the frame around it. */
export const TableRowsSkeleton = ({ columns, rows }: { columns: number; rows: number }) => (
  <Table>
    <TableHeader>
      <TableRow>
        {repeat(columns).map((index) => (
          <TableHead key={index}>
            <Skeleton className="h-3 w-16 rounded" />
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
    <TableBody>
      {repeat(rows).map((rowIndex) => (
        <TableRow key={rowIndex}>
          {repeat(columns).map((colIndex) => (
            <TableCell key={colIndex}>
              <Skeleton className={cn("h-4 rounded", cellWidthClass(colIndex))} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** Placeholder for a `DataTableView`: rows and their count bar inside one frame. */
export const TableSkeleton = ({
  columns = 5,
  rows = 5,
  hasFooter = true,
  className,
}: TableSkeletonProps) => (
  <ListPanel className={cn("skeleton-appear", className)}>
    <TableRowsSkeleton columns={Math.max(columns, 1)} rows={Math.max(rows, 1)} />
    {hasFooter ? (
      <ListPanelFooter>
        <div className="flex w-full items-center justify-between gap-2">
          <Skeleton className="h-3 w-32 rounded" />
          <div className="flex items-center gap-1">
            <Skeleton className="hidden size-6 rounded-md lg:block" />
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="size-6 rounded-md" />
            <Skeleton className="hidden size-6 rounded-md lg:block" />
          </div>
        </div>
      </ListPanelFooter>
    ) : null}
  </ListPanel>
);

interface TablePanelSkeletonProps {
  readonly columns?: number;
  readonly rows?: number;
  readonly className?: string;
}

/** Placeholder in the shape of `components/table-panel`: header, rows, count bar. */
export const TablePanelSkeleton = ({
  columns = 4,
  rows = 3,
  className,
}: TablePanelSkeletonProps) => (
  <ListPanel className={cn("skeleton-appear", className)}>
    {/* The rule belongs to the title bar, as it does in `ListPanelHeader` — a
        wrapper around the table would be read as the panel's own body and take
        the island's fill, leaving the column band inside it a shade out. */}
    <CardHeader className="border-kumo-line gap-2 border-b py-4">
      <Skeleton className="h-4 w-44 rounded" />
      <Skeleton className="h-3 w-72 rounded" />
    </CardHeader>
    <TableRowsSkeleton columns={Math.max(columns, 1)} rows={Math.max(rows, 1)} />
    <ListPanelFooter>
      <Skeleton className="h-3 w-32 rounded" />
    </ListPanelFooter>
  </ListPanel>
);

interface FilterBarSkeletonProps {
  readonly hasSearch?: boolean;
  readonly selectCount?: number;
  readonly className?: string;
}

export const FilterBarSkeleton = ({
  hasSearch = false,
  selectCount = 0,
  className,
}: FilterBarSkeletonProps) => (
  <div className={cn("skeleton-appear flex flex-wrap items-center gap-2", className)}>
    {hasSearch ? <Skeleton className="h-8 w-full rounded-md sm:w-56" /> : null}
    {repeat(selectCount).map((index) => (
      <Skeleton key={index} className="h-8 w-28 rounded-md" />
    ))}
  </div>
);

interface SettingCardSkeletonProps {
  readonly fields?: number;
  readonly hasFooter?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

export const SettingCardSkeleton = ({
  fields = 1,
  hasFooter = true,
  className,
  children,
}: SettingCardSkeletonProps) => (
  <Card className={cn("skeleton-appear", className)}>
    <CardHeader>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-3 w-64 rounded" />
      </div>
    </CardHeader>
    <CardContent>
      {children ?? (
        <div className="flex flex-col gap-4">
          {repeat(fields).map((index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      )}
    </CardContent>
    {hasFooter ? (
      <CardFooter className="justify-end gap-2">
        <Skeleton className="h-8 w-28 rounded-md" />
      </CardFooter>
    ) : null}
  </Card>
);

interface DetailCardSkeletonProps {
  readonly rows?: number;
  readonly columns?: 1 | 2 | 3 | 4;
  /** Omit where the panel it stands in for carries a bare title. */
  readonly hasDescription?: boolean;
  readonly className?: string;
}

const DETAIL_GRID_CLASS = {
  1: "grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
} as const;

export const DetailCardSkeleton = ({
  rows = 4,
  columns = 2,
  hasDescription = true,
  className,
}: DetailCardSkeletonProps) => (
  <Card className={cn("skeleton-appear gap-4 px-4", className)}>
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-40 rounded" />
      {hasDescription ? <Skeleton className="h-3 w-64 rounded" /> : null}
    </div>
    <div className={cn("grid gap-4", DETAIL_GRID_CLASS[columns])}>
      {repeat(rows * columns).map((index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-4 w-32 rounded" />
        </div>
      ))}
    </div>
  </Card>
);
