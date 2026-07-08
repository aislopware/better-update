import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { cn } from "@better-update/ui/lib/utils";
import { flexRender } from "@tanstack/react-table";

import type { Table as ReactTableT, Row } from "@tanstack/react-table";

import { cellAlignClass } from "./column-meta";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTablePagination } from "./data-table-pagination";

export interface DataTableViewProps<TData> {
  readonly table: ReactTableT<TData>;
  readonly columnsCount: number;
  readonly isPlaceholderData?: boolean | undefined;
  readonly countLabel?: string | undefined;
  readonly safePage?: number | undefined;
  readonly totalPages?: number | undefined;
  readonly onPageChange?: ((next: number) => void) | undefined;
  readonly onRowClick?: ((row: TData) => void | Promise<void>) | undefined;
  /** Shown as a full-width row when the table has no rows (filtered-empty state). */
  readonly emptyMessage?: string | undefined;
}

const DataTableFooterArea = ({
  countLabel,
  selectedCount,
  safePage,
  totalPages,
  isPlaceholderData,
  onPageChange,
}: {
  countLabel: string;
  selectedCount: number;
  safePage: number | undefined;
  totalPages: number | undefined;
  isPlaceholderData: boolean;
  onPageChange: ((next: number) => void) | undefined;
}) => {
  if (safePage !== undefined && totalPages !== undefined && onPageChange !== undefined) {
    return (
      <DataTablePagination
        countLabel={countLabel}
        selectedCount={selectedCount}
        safePage={safePage}
        totalPages={totalPages}
        isPlaceholderData={isPlaceholderData}
        onChange={onPageChange}
      />
    );
  }
  return (
    <span className="text-muted-foreground text-xs tabular-nums">
      {selectedCount > 0 ? `${selectedCount} selected` : countLabel}
    </span>
  );
};

const DataTableRow = <TData,>({
  row,
  onRowClick,
}: {
  row: Row<TData>;
  onRowClick: ((row: TData) => void | Promise<void>) | undefined;
}) => (
  <TableRow
    data-state={row.getIsSelected() ? "selected" : undefined}
    className={cn(onRowClick ? "cursor-pointer" : undefined)}
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
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      );
    })}
  </TableRow>
);

export const DataTableView = <TData,>({
  table,
  columnsCount,
  isPlaceholderData = false,
  countLabel,
  safePage,
  totalPages,
  onPageChange,
  onRowClick,
  emptyMessage,
}: DataTableViewProps<TData>) => {
  const { rows } = table.getRowModel();
  const selectedCount = table.getSelectedRowModel().rows.length;
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
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 && emptyMessage !== undefined ? (
              <TableRow>
                <TableCell
                  colSpan={columnsCount}
                  className="text-muted-foreground h-24 text-center whitespace-normal"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => <DataTableRow key={row.id} row={row} onRowClick={onRowClick} />)
            )}
          </TableBody>
        </Table>
      </div>
      {countLabel === undefined ? null : (
        <DataTableFooterArea
          countLabel={countLabel}
          selectedCount={selectedCount}
          safePage={safePage}
          totalPages={totalPages}
          isPlaceholderData={isPlaceholderData}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
