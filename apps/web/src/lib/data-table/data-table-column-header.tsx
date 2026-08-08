import { Button } from "@better-update/ui/components/button";
import { TableHead } from "@better-update/ui/components/table";
import { cn } from "@better-update/ui/lib/utils";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import { flexRender } from "@tanstack/react-table";

import type { Header } from "@tanstack/react-table";

import { columnWidthClass, headerAlignsRight } from "./column-meta";
import { SortIcon, toAriaSort } from "./sort-icon";

/**
 * Column header with an inline sort toggle (official shadcn data-table pattern).
 * Non-sortable columns render a plain TableHead; sortable columns get a ghost
 * button that cycles unsorted → asc → desc → unsorted (an empty sorting state
 * falls back to the page's default sort via useDataTableSearch).
 */
export const DataTableColumnHeader = <TData,>({ header }: { header: Header<TData, unknown> }) => {
  const { column } = header;
  const { meta } = column.columnDef;
  const alignRight = headerAlignsRight(meta);
  // The width claim has to be on the header too — auto layout sizes a column
  // from the widest declaration in it, header included.
  const headClassName = cn(alignRight && "text-right", columnWidthClass(meta));
  const content = header.isPlaceholder
    ? null
    : flexRender(column.columnDef.header, header.getContext());

  if (!column.getCanSort()) {
    return <TableHead className={headClassName}>{content}</TableHead>;
  }

  const sortDir = column.getIsSorted();
  const cycleSorting = (): void => {
    if (sortDir === false) {
      column.toggleSorting(false);
    } else if (sortDir === "asc") {
      column.toggleSorting(true);
    } else {
      column.clearSorting();
    }
  };

  return (
    <TableHead aria-sort={toAriaSort(sortDir)} className={headClassName}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "-ml-2 h-7 font-medium",
          // Unsorted headers stay quiet so the active sort stands out.
          sortDir === false ? "text-kumo-subtle hover:text-kumo-default" : "text-kumo-default",
          alignRight && "-mr-2 ml-0",
        )}
        onClick={cycleSorting}
      >
        {content}
        {sortDir === false ? (
          <CaretUpDownIcon weight="bold" className="text-kumo-subtle/72 size-3.5" />
        ) : (
          <SortIcon direction={sortDir} />
        )}
      </Button>
    </TableHead>
  );
};
