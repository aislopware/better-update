import { Button } from "@better-update/ui/components/ui/button";
import { TableHead } from "@better-update/ui/components/ui/table";
import { cn } from "@better-update/ui/lib/utils";
import { flexRender } from "@tanstack/react-table";
import { ChevronsUpDownIcon } from "lucide-react";

import type { Header } from "@tanstack/react-table";

import { headerAlignsRight } from "./column-meta";
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
  const content = header.isPlaceholder
    ? null
    : flexRender(column.columnDef.header, header.getContext());

  if (!column.getCanSort()) {
    return <TableHead className={cn(alignRight && "text-right")}>{content}</TableHead>;
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
    <TableHead aria-sort={toAriaSort(sortDir)} className={cn(alignRight && "text-right")}>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "-ml-2 h-7 font-medium",
          // Unsorted headers stay quiet so the active sort stands out.
          sortDir === false ? "text-muted-foreground hover:text-foreground" : "text-foreground",
          alignRight && "-mr-2 ml-0",
        )}
        onClick={cycleSorting}
      >
        {content}
        {sortDir === false ? (
          <ChevronsUpDownIcon strokeWidth={2} className="text-muted-foreground/72 size-3.5" />
        ) : (
          <SortIcon direction={sortDir} />
        )}
      </Button>
    </TableHead>
  );
};
