import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { cn } from "@better-update/ui/lib/utils";
import { flexRender } from "@tanstack/react-table";

import type { Cell, Table as ReactTableT, Row } from "@tanstack/react-table";
import type { MouseEvent, ReactNode } from "react";

import { cellAlignClass, columnWidthClass } from "./column-meta";
import { DataTableColumnHeader } from "./data-table-column-header";
import { FilteredEmptyState } from "./list-empty-state";
import { ListFooterArea } from "./list-footer";
import { ListPanel, ListPanelFooter, ListPanelHeader } from "./list-panel";
import { RowCaret } from "./row-caret";

import type { FilteredEmptyProps } from "./list-empty-state";
import type { ListPaginationFooter } from "./list-footer";

/** What a caller has to render for `renderRowLink`: its own `Link`, wearing these. */
export interface RowLinkProps {
  readonly className: string;
  readonly children: ReactNode;
}

export type RowLinkRender<TData> = (row: TData, props: RowLinkProps) => ReactNode;

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
  /**
   * Makes the row's own name a link to the row's page.
   *
   * Rows used to navigate through a click handler on the `<tr>`, which is a link
   * pretending not to be one: nothing to open in a new tab, nothing to copy, and
   * no way in at all from the keyboard. The caller renders the `Link` — the
   * route and its params stay typed at the call site — and this view hands it
   * the class and the cell content to wrap.
   */
  readonly renderRowLink?: RowLinkRender<TData> | undefined;
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

// The link takes the whole cell so its focus ring frames the name rather than a
// word inside it, and inherits the cell's own type — it is the row's name, not a
// styled-up hyperlink sitting in a table.
const ROW_LINK_CLASS =
  "focus-visible:ring-kumo-focus block min-w-0 rounded-sm text-inherit no-underline outline-none focus-visible:ring-2";

/** Which cell holds the row's name: the primary column, else the first one. */
const linkCellId = <TData,>(row: Row<TData>): string | undefined => {
  const cells = row.getVisibleCells();
  return (cells.find((cell) => cell.column.columnDef.meta?.primary) ?? cells[0])?.id;
};

// Clicking the row still opens it, because the row is one thing and reading half
// of it as "not the link" is a distinction nobody makes with a mouse. The click
// is forwarded to the anchor the name already is, so there is one destination
// rather than two that can drift; anything the row itself handles — a menu, a
// copy button, a select — has already stopped the event before it arrives.
//
// The forward is deliberately narrow. A plain click on the name is already
// handled (the router calls preventDefault, so this returns). A cmd/ctrl/shift
// click is the browser's to answer — forwarding it would open the new tab *and*
// navigate this one — and so is anything that started inside a link already.
// Ending a text selection inside a row is reading, not navigating.
const followRowLink = (event: MouseEvent<HTMLElement>): void => {
  const startedInALink = event.target instanceof HTMLElement && event.target.closest("a") !== null;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    startedInALink ||
    document.getSelection()?.isCollapsed === false
  ) {
    return;
  }
  event.currentTarget.querySelector<HTMLAnchorElement>("[data-row-link] a")?.click();
};

const DataTableRow = <TData,>({
  row,
  renderRowLink,
}: {
  row: Row<TData>;
  renderRowLink: RowLinkRender<TData> | undefined;
}) => {
  const nameCellId = renderRowLink ? linkCellId(row) : undefined;
  return (
    <TableRow
      className={cn(
        "group/row",
        ROW_ACTION_DISCLOSURE,
        renderRowLink ? "cursor-pointer" : undefined,
      )}
      onClick={renderRowLink ? followRowLink : undefined}
    >
      {row.getVisibleCells().map((cell) => {
        const { meta } = cell.column.columnDef;
        const content = renderCell(cell);
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
            {renderRowLink && cell.id === nameCellId ? (
              // `contents` so the wrapper is a hook for the row's click and
              // nothing else — the cell's own layout stays as the column drew it.
              <span data-row-link className="contents">
                {renderRowLink(row.original, { className: ROW_LINK_CLASS, children: content })}
              </span>
            ) : (
              content
            )}
          </TableCell>
        );
      })}
      {renderRowLink ? (
        <TableCell aria-hidden className="w-8 pl-0">
          <RowCaret />
        </TableCell>
      ) : null}
    </TableRow>
  );
};

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
  // Nothing here is a row to act on, so the pointer gets no answer — but the
  // colour has to be the island's own, not transparent: a cell takes its
  // background from its row, and behind the rows is the panel's chrome.
  <TableRow className="hover:bg-kumo-base">
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
  renderRowLink,
  emptyMessage,
  filteredEmpty,
}: DataTableViewProps<TData>) => {
  const { rows } = table.getRowModel();
  // Linked rows carry a trailing chevron-affordance column.
  const totalColumns = renderRowLink ? columnsCount + 1 : columnsCount;
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
              {renderRowLink ? <TableHead aria-hidden className="w-8" /> : null}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0
            ? emptyRow
            : rows.map((row) => (
                <DataTableRow key={row.id} row={row} renderRowLink={renderRowLink} />
              ))}
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
