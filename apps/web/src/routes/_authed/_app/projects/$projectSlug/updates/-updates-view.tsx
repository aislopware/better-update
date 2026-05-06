import { Button } from "@better-update/ui/components/ui/button";
import { Frame } from "@better-update/ui/components/ui/frame";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
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
import { flexRender } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import type { Table as ReactTableT } from "@tanstack/react-table";

import type { ColumnMeta, UpdateItem } from "./-updates-columns";

interface BranchOption {
  readonly id: string;
  readonly name: string;
}

const PLATFORM_FILTER_LABELS: Record<string, string> = {
  all: "All platforms",
  ios: "iOS",
  android: "Android",
};

export const UpdatesFilterBar = ({
  branches,
  branchFilterLabels,
  branchFilter,
  platformFilter,
  onBranchFilter,
  onPlatformFilter,
}: {
  branches: readonly BranchOption[];
  branchFilterLabels: Record<string, string>;
  branchFilter: string | undefined;
  platformFilter: "ios" | "android" | undefined;
  onBranchFilter: (value: string | undefined) => void;
  onPlatformFilter: (value: "ios" | "android" | undefined) => void;
}) => (
  <>
    <Select
      items={PLATFORM_FILTER_LABELS}
      value={platformFilter ?? "all"}
      onValueChange={(value) => {
        if (value === "ios" || value === "android") {
          onPlatformFilter(value);
        } else {
          onPlatformFilter(undefined);
        }
      }}
    >
      <SelectTrigger className="w-36">
        <SelectValue placeholder="All platforms" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectItem value="all">All platforms</SelectItem>
          <SelectItem value="ios">iOS</SelectItem>
          <SelectItem value="android">Android</SelectItem>
        </SelectGroup>
      </SelectPopup>
    </Select>
    <Select
      items={branchFilterLabels}
      value={branchFilter ?? "all"}
      onValueChange={(value) => {
        if (value) {
          onBranchFilter(value === "all" ? undefined : value);
        }
      }}
    >
      <SelectTrigger className="w-48">
        <SelectValue placeholder="All branches" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectItem value="all">All branches</SelectItem>
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  </>
);

const ARIA_SORT_MAP = { asc: "ascending", desc: "descending" } as const;
const toAriaSort = (direction: false | "asc" | "desc"): "ascending" | "descending" | "none" =>
  direction === false ? "none" : ARIA_SORT_MAP[direction];

const SortIcon = ({ direction }: { direction: false | "asc" | "desc" }) => {
  if (direction === "asc") {
    return <ArrowUpIcon strokeWidth={2} className="size-3.5" />;
  }
  if (direction === "desc") {
    return <ArrowDownIcon strokeWidth={2} className="size-3.5" />;
  }
  return null;
};

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

const PaginationControls = ({
  countLabel,
  safePage,
  totalPages,
  isPlaceholderData,
  onChange,
}: {
  countLabel: string;
  safePage: number;
  totalPages: number;
  isPlaceholderData: boolean;
  onChange: (next: number) => void;
}) => (
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

export const UpdatesTableView = ({
  table,
  columnsCount,
  isPlaceholderData,
  countLabel,
  safePage,
  totalPages,
  onPageChange,
}: {
  table: ReactTableT<UpdateItem>;
  columnsCount: number;
  isPlaceholderData: boolean;
  countLabel: string;
  safePage: number;
  totalPages: number;
  onPageChange: (next: number) => void;
}) => (
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
          <TableCell colSpan={columnsCount}>
            <PaginationControls
              countLabel={countLabel}
              safePage={safePage}
              totalPages={totalPages}
              isPlaceholderData={isPlaceholderData}
              onChange={onPageChange}
            />
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  </Frame>
);
