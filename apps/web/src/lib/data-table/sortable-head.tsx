import { TableHead } from "@better-update/ui/components/ui/table";
import { cn } from "@better-update/ui/lib/utils";
import { flexRender } from "@tanstack/react-table";

import type { Header } from "@tanstack/react-table";

import { SortIcon, toAriaSort } from "./sort-icon";

export const SortableHead = <TData,>({ header }: { header: Header<TData, unknown> }) => {
  const { meta } = header.column.columnDef;
  const sortDir = header.column.getIsSorted();
  const canSort = header.column.getCanSort();
  return (
    <TableHead
      className={cn(
        meta?.align === "right" ? "text-right" : "",
        canSort ? "hover:text-foreground cursor-pointer transition-colors select-none" : "",
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
};
