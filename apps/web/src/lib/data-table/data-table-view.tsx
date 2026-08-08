import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { cn } from "@better-update/ui/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { flexRender } from "@tanstack/react-table";

import type { Cell, Table as ReactTableT, Row } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { cellAlignClass, columnWidthClass } from "./column-meta";
import { DataTableColumnHeader } from "./data-table-column-header";
import { FilteredEmptyState } from "./list-empty-state";
import { ListFooterArea } from "./list-footer";
import { ListPanel, ListPanelFooter, ListPanelHeader } from "./list-panel";

import type { FilteredEmptyProps } from "./list-empty-state";
import type { ListPaginationFooter } from "./list-footer";

export interface DataTableViewProps<TData> {
  readonly table: ReactTableT<TData>;
  readonly columnsCount: number;
  /**
   * Names the list from inside its own frame. For a page whose whole subject is
   * the list, leave it off — the page title already says what these rows are.
   */
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly isPlaceholderData?: boolean | undefined;
  /** Plain footer text for lists that fetch everything at once. */
  readonly countLabel?: string | undefined;
  /** Paginated footer — supersedes `countLabel`, which it derives itself. */
  readonly pagination?: ListPaginationFooter | undefined;
  readonly onRowClick?: ((row: TData) => void | Promise<void>) | undefined;
  /** Shown as a full-width row when the table has no rows (filtered-empty state). */
  readonly emptyMessage?: string | undefined;
  /**
   * Compact passive zero-result state (icon + "No <entity> match your filters."
   * + Clear filters) shown instead of `emptyMessage` while filters are active.
   * True-zero (isFiltered false) falls back to the page's own empty handling.
   */
  readonly filteredEmpty?: FilteredEmptyProps | undefined;
}

// ⋮ row-action triggers rest hidden on fine pointers and disclose on row hover,
// keyboard focus anywhere in the row, or while their menu is open (the popup
// portals focus away, so aria-expanded/data-popup-open keep it shown). Coarse
// pointers never hide the trigger — there is no hover to reveal it.
//
// The trigger is matched by `aria-haspopup=menu` rather than a marker
// attribute: Kumo tags its own parts and knows nothing about the row, and the
// only other popup a row opens is a role select, which announces `listbox`.
export const ROW_ACTION_DISCLOSURE = cn(
  "pointer-fine:[&_[aria-haspopup=menu]]:opacity-0",
  "[&_[aria-haspopup=menu]]:transition-opacity",
  "[&_[aria-haspopup=menu]]:duration-(--duration-quick)",
  "[&:hover_[aria-haspopup=menu]]:opacity-100",
  "[&:focus-within_[aria-haspopup=menu]]:opacity-100",
  "[&_[aria-haspopup=menu][aria-expanded=true]]:opacity-100",
  "[&_[aria-haspopup=menu][data-popup-open]]:opacity-100",
);

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
          className={cn(cellAlignClass(meta), columnWidthClass(meta))}
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
          className="text-kumo-subtle size-4 opacity-0 transition-opacity duration-(--duration-quick) group-focus-within/row:opacity-100 group-hover/row:opacity-100"
        />
      </TableCell>
    ) : null}
  </TableRow>
);

const MessageEmptyRow = ({ columnsCount, message }: { columnsCount: number; message: string }) => (
  <TableRow>
    <TableCell
      colSpan={columnsCount}
      className="text-kumo-subtle h-24 text-center whitespace-normal"
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
      <FilteredEmptyState entity={entity} onClear={onClear} />
    </TableCell>
  </TableRow>
);

export const DataTableView = <TData,>({
  table,
  columnsCount,
  title,
  description,
  actions,
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
  const hasFooter = pagination !== undefined || countLabel !== undefined;
  return (
    <ListPanel
      className={cn("transition-opacity", isPlaceholderData ? "opacity-60" : "opacity-100")}
    >
      {title === undefined ? null : (
        <ListPanelHeader title={title} description={description} actions={actions} />
      )}
      {/* Headers never wrap: a two-line "Build number" over one-line neighbours
          makes a straight header row look broken, and the primary column has
          already taken the width the others would have wrapped to fit. */}
      <Table className="[&_th]:whitespace-nowrap">
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
      {hasFooter ? (
        <ListPanelFooter>
          <ListFooterArea
            countLabel={countLabel}
            pagination={pagination}
            isPlaceholderData={isPlaceholderData}
          />
        </ListPanelFooter>
      ) : null}
    </ListPanel>
  );
};
