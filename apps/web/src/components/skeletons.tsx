import { Card, CardContent, CardFooter, CardHeader } from "@better-update/ui/components/ui/card";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

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

export const TableSkeleton = ({
  columns = 5,
  rows = 5,
  hasFooter = true,
  className,
}: TableSkeletonProps) => {
  const safeColumns = Math.max(columns, 1);
  const safeRows = Math.max(rows, 1);
  return (
    <div className={cn("skeleton-appear flex flex-col gap-3", className)}>
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {repeat(safeColumns).map((index) => (
                <TableHead key={index}>
                  <Skeleton className="h-3 w-16 rounded" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {repeat(safeRows).map((rowIndex) => (
              <TableRow key={rowIndex}>
                {repeat(safeColumns).map((colIndex) => (
                  <TableCell key={colIndex}>
                    <Skeleton className={cn("h-4 rounded", cellWidthClass(colIndex))} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {hasFooter ? (
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3 w-32 rounded" />
          <div className="flex items-center gap-4">
            <Skeleton className="hidden h-3 w-20 rounded sm:block" />
            <div className="flex items-center gap-1">
              <Skeleton className="hidden size-6 rounded-md lg:block" />
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="hidden size-6 rounded-md lg:block" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

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

interface ListItemsSkeletonProps {
  readonly rows?: number;
  readonly hasTrailingButton?: boolean;
  readonly className?: string;
}

export const ListItemsSkeleton = ({
  rows = 3,
  hasTrailingButton = true,
  className,
}: ListItemsSkeletonProps) => (
  <div className={cn("skeleton-appear flex w-full flex-col gap-2.5", className)}>
    {repeat(rows).map((index) => (
      <div
        key={index}
        className="border-border flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
      >
        <Skeleton className="size-8 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Skeleton className="h-3.5 w-44 rounded" />
          <Skeleton className="h-3 w-64 rounded" />
        </div>
        {hasTrailingButton ? <Skeleton className="h-8 w-24 rounded-md" /> : null}
      </div>
    ))}
  </div>
);

interface SectionSkeletonProps {
  readonly children: ReactNode;
  readonly hasAction?: boolean;
  readonly className?: string;
}

export const SectionSkeleton = ({ children, hasAction, className }: SectionSkeletonProps) => (
  <section className={cn("skeleton-appear flex flex-col gap-3", className)}>
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-44 rounded" />
        <Skeleton className="h-3 w-72 rounded" />
      </div>
      {hasAction ? <Skeleton className="h-9 w-32 rounded-md" /> : null}
    </div>
    {children}
  </section>
);

interface DetailCardSkeletonProps {
  readonly rows?: number;
  readonly columns?: 1 | 2;
  readonly className?: string;
}

export const DetailCardSkeleton = ({
  rows = 4,
  columns = 2,
  className,
}: DetailCardSkeletonProps) => (
  <Card className={cn("skeleton-appear gap-4 px-4", className)}>
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-40 rounded" />
      <Skeleton className="h-3 w-64 rounded" />
    </div>
    <div className={cn("grid gap-4", columns === 2 ? "sm:grid-cols-2" : "grid-cols-1")}>
      {repeat(rows * columns).map((index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-4 w-32 rounded" />
        </div>
      ))}
    </div>
  </Card>
);

interface SummaryCardsSkeletonProps {
  readonly count?: number;
  readonly className?: string;
}

export const SummaryCardsSkeleton = ({ count = 3, className }: SummaryCardsSkeletonProps) => (
  <div className={cn("skeleton-appear @container/stat-grid", className)}>
    <div className="grid grid-cols-1 gap-4 @xl/stat-grid:grid-cols-2 @5xl/stat-grid:grid-cols-4">
      {repeat(count).map((index) => (
        <Card key={index} className="gap-1 px-4">
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-8 w-20 rounded" />
        </Card>
      ))}
    </div>
  </div>
);
