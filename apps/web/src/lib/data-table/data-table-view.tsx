import { Frame } from "@better-update/ui/components/ui/frame";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { cn } from "@better-update/ui/lib/utils";
import { flexRender } from "@tanstack/react-table";

import type { Table as ReactTableT, Row } from "@tanstack/react-table";

import { cellAlignClass } from "./column-meta";
import { PaginationControls } from "./pagination-controls";
import { SortableHead } from "./sortable-head";

export interface DataTableViewProps<TData> {
  readonly table: ReactTableT<TData>;
  readonly columnsCount: number;
  readonly isPlaceholderData?: boolean | undefined;
  readonly countLabel?: string | undefined;
  readonly safePage?: number | undefined;
  readonly totalPages?: number | undefined;
  readonly onPageChange?: ((next: number) => void) | undefined;
  readonly onRowClick?: ((row: TData) => void | Promise<void>) | undefined;
}

const DataTableFooter = ({
  columnsCount,
  countLabel,
  safePage,
  totalPages,
  isPlaceholderData,
  onPageChange,
}: {
  columnsCount: number;
  countLabel: string;
  safePage: number | undefined;
  totalPages: number | undefined;
  isPlaceholderData: boolean;
  onPageChange: ((next: number) => void) | undefined;
}) => {
  const hasPagination =
    safePage !== undefined && totalPages !== undefined && onPageChange !== undefined;
  return (
    <TableFooter>
      <TableRow>
        <TableCell
          colSpan={columnsCount}
          className={hasPagination ? undefined : "text-muted-foreground text-xs tabular-nums"}
        >
          {hasPagination ? (
            <PaginationControls
              countLabel={countLabel}
              safePage={safePage}
              totalPages={totalPages}
              isPlaceholderData={isPlaceholderData}
              onChange={onPageChange}
            />
          ) : (
            countLabel
          )}
        </TableCell>
      </TableRow>
    </TableFooter>
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
}: DataTableViewProps<TData>) => (
  <Frame
    className={
      isPlaceholderData ? "opacity-60 transition-opacity" : "opacity-100 transition-opacity"
    }
  >
    <Table variant="card">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <SortableHead key={header.id} header={header} />
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <DataTableRow key={row.id} row={row} onRowClick={onRowClick} />
        ))}
      </TableBody>
      {countLabel === undefined ? null : (
        <DataTableFooter
          columnsCount={columnsCount}
          countLabel={countLabel}
          safePage={safePage}
          totalPages={totalPages}
          isPlaceholderData={isPlaceholderData}
          onPageChange={onPageChange}
        />
      )}
    </Table>
  </Frame>
);
