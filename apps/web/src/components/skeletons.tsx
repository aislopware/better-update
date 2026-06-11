import { Card } from "@better-update/ui/components/ui/card";
import { Frame } from "@better-update/ui/components/ui/frame";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
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
    <Frame className={cn("overflow-hidden", className)}>
      <Table variant="card">
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
        {hasFooter ? (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={safeColumns}>
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-3 w-32 rounded" />
                  <div className="flex items-center gap-1">
                    <Skeleton className="size-6 rounded-md" />
                    <Skeleton className="size-6 rounded-md" />
                  </div>
                </div>
              </TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </Frame>
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
  <div className={cn("flex flex-wrap items-center gap-2", className)}>
    {hasSearch ? <Skeleton className="h-9 min-w-56 flex-1 rounded-md" /> : null}
    {repeat(selectCount).map((index) => (
      <Skeleton key={index} className="h-9 w-40 rounded-md" />
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
  <Card className={cn("gap-4 p-6", className)} render={<section />}>
    <header className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-3 w-64 rounded" />
      </div>
    </header>
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
    {hasFooter ? (
      <footer className="bg-muted/72 -mx-6 mt-2 -mb-6 flex items-center justify-end gap-2 rounded-b-[calc(var(--radius-2xl)-1px)] border-t px-6 py-3">
        <Skeleton className="h-8 w-28 rounded-md" />
      </footer>
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
  <ul className={cn("-my-3 flex flex-col divide-y", className)}>
    {repeat(rows).map((index) => (
      <li key={index} className="flex items-center gap-3 py-3">
        <Skeleton className="size-9 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Skeleton className="h-3.5 w-44 rounded" />
          <Skeleton className="h-3 w-64 rounded" />
        </div>
        {hasTrailingButton ? <Skeleton className="h-8 w-24 rounded-md" /> : null}
      </li>
    ))}
  </ul>
);

interface SectionSkeletonProps {
  readonly children: ReactNode;
  readonly hasAction?: boolean;
  readonly className?: string;
}

export const SectionSkeleton = ({ children, hasAction, className }: SectionSkeletonProps) => (
  <section className={cn("flex flex-col gap-3", className)}>
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
  <Card className={cn("gap-4 p-6", className)}>
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
  <div className={cn("grid gap-4 sm:grid-cols-3", className)}>
    {repeat(count).map((index) => (
      <Card key={index} className="gap-3 p-6">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-5 w-40 rounded" />
      </Card>
    ))}
  </div>
);
