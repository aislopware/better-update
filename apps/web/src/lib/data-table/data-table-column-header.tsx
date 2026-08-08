import { Button } from "@better-update/ui/components/button";
import { TableHead } from "@better-update/ui/components/table";
import { cn } from "@better-update/ui/lib/utils";
import { CaretUpDownIcon } from "@phosphor-icons/react";
import { flexRender } from "@tanstack/react-table";

import type { Header } from "@tanstack/react-table";

import { columnWidthClass, headerAlignsRight } from "./column-meta";
import { SortIcon, toAriaSort } from "./sort-icon";

/**
 * Column header with an inline sort toggle. Non-sortable columns render a plain
 * TableHead; sortable columns get a ghost button that cycles unsorted → asc →
 * desc → unsorted (an empty sorting state falls back to the page's default sort
 * via useDataTableSearch). Both read alike — the header band is one row of
 * labels, and only the arrow says which of them the rows are ordered by.
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
          // A sortable header is the same label as a fixed one — the button is
          // only what makes it clickable, so it borrows the header row's own
          // type and colour instead of the button's. Which column is sorted is
          // the arrow's job; saying it again in ink made the other five labels
          // look disabled.
          // Height comes from the band's own padding, not the button's, so a
          // sortable label does not stand taller than the ones beside it.
          "-ml-2 h-auto py-0 text-base font-semibold text-inherit",
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
