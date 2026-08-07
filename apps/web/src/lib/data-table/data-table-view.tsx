import { Button } from "@better-update/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { cn } from "@better-update/ui/lib/utils";
import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { flexRender } from "@tanstack/react-table";

import type { Cell, Table as ReactTableT, Row } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { cellAlignClass } from "./column-meta";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTablePagination } from "./data-table-pagination";

import type { DataTablePaginationProps } from "./data-table-pagination";

/** What a caller supplies; `isPlaceholderData` comes from the view itself. */
export type DataTablePaginationFooter = Omit<DataTablePaginationProps, "isPlaceholderData">;

export interface DataTableFilteredEmptyProps {
  /** Plural entity noun — copy renders as "No <entity> match your filters." */
  readonly entity: string;
  /** True while any filter/search is active (mirror the toolbar's isFiltered). */
  readonly isFiltered: boolean;
  /** Wire to the same reset handler as the toolbar's onReset. */
  readonly onClear: () => void;
}

export interface DataTableViewProps<TData> {
  readonly table: ReactTableT<TData>;
  readonly columnsCount: number;
  readonly isPlaceholderData?: boolean | undefined;
  /** Plain footer text for lists that fetch everything at once. */
  readonly countLabel?: string | undefined;
  /** Paginated footer — supersedes `countLabel`, which it derives itself. */
  readonly pagination?: DataTablePaginationFooter | undefined;
  readonly onRowClick?: ((row: TData) => void | Promise<void>) | undefined;
  /** Shown as a full-width row when the table has no rows (filtered-empty state). */
  readonly emptyMessage?: string | undefined;
  /**
   * Compact passive zero-result state (icon + "No <entity> match your filters."
   * + Clear filters) shown instead of `emptyMessage` while filters are active.
   * True-zero (isFiltered false) falls back to the page's own empty handling.
   */
  readonly filteredEmpty?: DataTableFilteredEmptyProps | undefined;
}

// ⋮ row-action triggers rest hidden on fine pointers and disclose on row hover,
// keyboard focus anywhere in the row, or while their menu is open (the popup
// portals focus away, so aria-expanded/data-popup-open keep it shown). Coarse
// pointers never hide the trigger — there is no hover to reveal it.
//
// The trigger is matched by `aria-haspopup=menu` rather than a marker
// attribute: Kumo tags its own parts and knows nothing about the row, and the
// only other popup a row opens is a role select, which announces `listbox`.
const ROW_ACTION_DISCLOSURE = cn(
  "pointer-fine:[&_[aria-haspopup=menu]]:opacity-0",
  "[&_[aria-haspopup=menu]]:transition-opacity",
  "[&_[aria-haspopup=menu]]:duration-(--duration-quick)",
  "[&:hover_[aria-haspopup=menu]]:opacity-100",
  "[&:focus-within_[aria-haspopup=menu]]:opacity-100",
  "[&_[aria-haspopup=menu][aria-expanded=true]]:opacity-100",
  "[&_[aria-haspopup=menu][data-popup-open]]:opacity-100",
);

const DataTableFooterArea = ({
  countLabel,
  pagination,
  isPlaceholderData,
}: {
  countLabel: string | undefined;
  pagination: DataTablePaginationFooter | undefined;
  isPlaceholderData: boolean;
}) => {
  if (pagination) {
    const { onChange: handlePageChange, ...rest } = pagination;
    return (
      <DataTablePagination
        page={rest.page}
        perPage={rest.perPage}
        totalCount={rest.totalCount}
        entity={rest.entity}
        isFiltered={rest.isFiltered}
        isPlaceholderData={isPlaceholderData}
        onChange={handlePageChange}
      />
    );
  }
  return countLabel === undefined ? null : (
    <span className="text-muted-foreground text-xs tabular-nums">{countLabel}</span>
  );
};

const isMissingValue = (value: unknown): boolean => value === undefined || value === null;

// Em-dash for absent values is gated on typed columns with a real accessor so
// renderer-only columns (no accessorKey/accessorFn) keep their own output.
const renderCell = <TData,>(cell: Cell<TData, unknown>): ReactNode =>
  cell.column.columnDef.meta?.cellType !== undefined &&
  cell.column.accessorFn !== undefined &&
  isMissingValue(cell.getValue())
    ? "—"
    : flexRender(cell.column.columnDef.cell, cell.getContext());

const DataTableRow = <TData,>({
  row,
  onRowClick,
}: {
  row: Row<TData>;
  onRowClick: ((row: TData) => void | Promise<void>) | undefined;
}) => (
  <TableRow
    className={cn("group/row", ROW_ACTION_DISCLOSURE, onRowClick ? "cursor-pointer" : undefined)}
    onClick={
      onRowClick
        ? async () => {
            await onRowClick(row.original);
          }
        : undefined
    }
  >
    {row.getVisibleCells().map((cell) => {
      const { meta } = cell.column.columnDef;
      return (
        <TableCell
          key={cell.id}
          className={cellAlignClass(meta)}
          onClick={
            meta?.stopRowClick
              ? (event) => {
                  event.stopPropagation();
                }
              : undefined
          }
        >
          {renderCell(cell)}
        </TableCell>
      );
    })}
    {onRowClick ? (
      <TableCell aria-hidden className="w-8 pl-0">
        <CaretRightIcon
          weight="bold"
          className="text-muted-foreground size-4 opacity-0 transition-opacity duration-(--duration-quick) group-focus-within/row:opacity-100 group-hover/row:opacity-100"
        />
      </TableCell>
    ) : null}
  </TableRow>
);

const MessageEmptyRow = ({ columnsCount, message }: { columnsCount: number; message: string }) => (
  <TableRow>
    <TableCell
      colSpan={columnsCount}
      className="text-muted-foreground h-24 text-center whitespace-normal"
    >
      {message}
    </TableCell>
  </TableRow>
);

const FilteredEmptyRow = ({
  columnsCount,
  entity,
  onClear,
}: {
  columnsCount: number;
  entity: string;
  onClear: () => void;
}) => (
  <TableRow className="hover:bg-transparent">
    <TableCell colSpan={columnsCount} className="whitespace-normal">
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <MagnifyingGlassIcon className="text-muted-foreground/72 size-5" aria-hidden />
        <p className="text-muted-foreground text-sm">No {entity} match your filters.</p>
        <Button variant="secondary" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    </TableCell>
  </TableRow>
);

export const DataTableView = <TData,>({
  table,
  columnsCount,
  isPlaceholderData = false,
  countLabel,
  pagination,
  onRowClick,
  emptyMessage,
  filteredEmpty,
}: DataTableViewProps<TData>) => {
  const { rows } = table.getRowModel();
  // Clickable rows carry a trailing chevron-affordance column.
  const totalColumns = onRowClick ? columnsCount + 1 : columnsCount;
  const messageEmptyRow =
    emptyMessage === undefined ? null : (
      <MessageEmptyRow columnsCount={totalColumns} message={emptyMessage} />
    );
  const emptyRow = filteredEmpty?.isFiltered ? (
    <FilteredEmptyRow
      columnsCount={totalColumns}
      entity={filteredEmpty.entity}
      onClear={() => {
        filteredEmpty.onClear();
      }}
    />
  ) : (
    messageEmptyRow
  );
  return (
    <div
      className={cn(
        "flex flex-col gap-3 transition-opacity",
        isPlaceholderData ? "opacity-60" : "opacity-100",
      )}
    >
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <DataTableColumnHeader key={header.id} header={header} />
                ))}
                {onRowClick ? <TableHead aria-hidden className="w-8" /> : null}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0
              ? emptyRow
              : rows.map((row) => <DataTableRow key={row.id} row={row} onRowClick={onRowClick} />)}
          </TableBody>
        </Table>
      </div>
      <DataTableFooterArea
        countLabel={countLabel}
        pagination={pagination}
        isPlaceholderData={isPlaceholderData}
      />
    </div>
  );
};
