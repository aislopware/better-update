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
        // The rows are an island: a page-coloured slab with all four corners
        // curved, set into the panel's chrome. The chrome is what shows through
        // at the corners, so it is painted once behind the whole body and the
        // rows sit on top of it — a row's own colour is what a cell inherits,
        // which is what lets a rounded corner clip it and still follow the row
        // through hover.
        "[&_tbody]:bg-kumo-elevated [&_tbody_tr]:bg-kumo-base [&_tbody_td]:bg-inherit",
        "[&_tbody_tr:first-child_td:first-child]:rounded-tl-lg",
        "[&_tbody_tr:first-child_td:last-child]:rounded-tr-lg",
        "[&_tbody_tr:last-child_td:first-child]:rounded-bl-lg",
        "[&_tbody_tr:last-child_td:last-child]:rounded-br-lg",
        // The island's outline has to turn those corners, and a border cannot:
        // `border-collapse: collapse` drops border-radius for borders while
        // still honouring it for the background, so the fill curved away and
        // the line carried straight on underneath. An inset shadow is painted
        // with the radius, so it turns the corner. Every row draws the rule
        // below it; the first row draws the one above it too, in the same
        // declaration, so a table of exactly one row is still closed on both
        // sides. `--color-kumo-fill` is the colour Kumo gives the border they
        // replace, and the border keeps its width so nothing shifts.
        "[&_tbody_td]:border-b-transparent",
        "[&_tbody_td]:shadow-[inset_0_-1px_0_var(--color-kumo-fill)]",
        "[&_tbody_tr:first-child_td]:shadow-[inset_0_1px_0_var(--color-kumo-fill),inset_0_-1px_0_var(--color-kumo-fill)]",
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
        // The header band, as the Cloudflare dashboard frames it: a strip with
        // its own fill filling the top of the panel's rounded frame, deep enough
        // to read as a band rather than a tight rule. Kumo gives it `py-2`,
        // which leaves the labels closer to the first row than to the frame
        // above them. The extra element in the selector is what beats Kumo's own
        // `[&_th]:p-3` on the root, which ties on specificity and wins on order.
        "[&_thead[data-compact]_th]:py-3",
        // Muted is the resting voice of a label, so the one column the rows are
        // actually ordered by can be the one in full ink. It used to be the
        // other way round — every label at full strength, the sort said only by
        // an arrow — which is a band of six shouted words above the data they
        // describe. `aria-sort` is already on the cell, so nothing has to be
        // threaded down for this.
        "[&_thead[data-compact]_th]:text-kumo-subtle",
        "[&_thead[data-compact]_th[aria-sort=ascending]]:text-kumo-strong",
        "[&_thead[data-compact]_th[aria-sort=descending]]:text-kumo-strong",
        // The band is a rectangle to its own edges, with no rule of its own:
        // the curve at the top of the island is the island's, and the rule that
        // separates the two is drawn by the first row so that it can follow it.
        "[&_thead[data-compact]_th]:border-b-transparent",
        className,
      )}
    />
  </div>
);
