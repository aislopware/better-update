// Hand-written, unlike its neighbours: Kumo's `Table` styles the table element
// itself and leaves two things to the caller that every table here wants — a
// horizontal scroll container (which its own sticky-column support requires)
// and a row hover. Both live here so a table is one import and behaves the same
// wherever it appears, and so Kumo's compound parts keep the flat names the app
// already reads.
import { Table as KumoTable } from "@cloudflare/kumo/components/table";

import type { ComponentProps } from "react";

import { cn } from "#/lib/utils";

/**
 * Kumo's compact header by default: a tinted band with tighter rows, which is
 * how the Cloudflare dashboard separates the labels from the data. The roomy
 * default header reads as a first row of the table rather than its heading, so
 * every table here wears the band unless a caller asks for `variant="default"`.
 */
export const TableHeader = ({
  variant = "compact",
  ...props
}: ComponentProps<typeof KumoTable.Header>) => (
  // eslint-disable-next-line react/jsx-props-no-spreading -- default-setting wrapper over Kumo's Table.Header
  <KumoTable.Header variant={variant} {...props} />
);

export const TableHead = KumoTable.Head;
export const TableBody = KumoTable.Body;
export const TableRow = KumoTable.Row;
export const TableCell = KumoTable.Cell;
/** Row-selection cells. Wire them to `checked` / `onCheckedChange`. */
export const TableCheckHead = KumoTable.CheckHead;
export const TableCheckCell = KumoTable.CheckCell;

export const Table = ({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof KumoTable> & {
  /** Classes for the scroll container — where a height cap or a border belongs. */
  readonly containerClassName?: string;
}) => (
  <div
    data-slot="table-container"
    // `overflow-x-auto` is what makes a sticky column or a sticky header stick
    // to something; without a scrollport they are inert.
    className={cn("relative w-full overflow-x-auto", containerClassName)}
  >
    <KumoTable
      // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Kumo's Table
      {...props}
      className={cn(
        // Kumo leaves rows inert. A dashboard table is scanned row-wise, so the
        // row under the pointer — or the one whose action menu is open — reads
        // as the active one.
        "[&_tbody_tr:hover]:bg-kumo-tint [&_tbody_tr:has([aria-expanded=true])]:bg-kumo-tint",
        // Wrapping is what makes a wide table unreadable: it ripples one long
        // value into every row's height. Cells keep to one line and the
        // container scrolls instead.
        "[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap",
        // Digits line up column-wise, so counts and versions compare by eye.
        "[&_td]:tabular-nums",
        // Kumo's compact header asks for `text-xs`, then its own root rule sets
        // `[&_th]:text-base [&_th]:font-semibold` at the same specificity and
        // wins the tie — so the band came out 14px semibold, a heavier line than
        // the data under it and the loudest type on a list page. The extra
        // element in the selector settles it: labels sit a step below the rows
        // they head, which is what makes them read as a heading and not as row
        // zero.
        "[&_thead[data-compact]_th]:text-xs [&_thead[data-compact]_th]:font-medium",
        className,
      )}
    />
  </div>
);
