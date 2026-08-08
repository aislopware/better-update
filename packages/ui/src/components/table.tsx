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
        // …and it is a rounded strip, not a rectangle with a rule under it.
        // Its top corners come free — the panel clips its children, and when
        // the band is the first thing inside it, it is flush against that
        // curve. The bottom two have nothing to clip them, so the end cells
        // carry the radius themselves.
        "[&_thead[data-compact]_th:first-child]:rounded-bl-lg",
        "[&_thead[data-compact]_th:last-child]:rounded-br-lg",
        // The rule under the band has to follow that curve, and a border
        // cannot: `border-collapse: collapse` drops the radius for borders
        // while still honouring it for the background, so the fill curved away
        // and the line carried straight on underneath — a rounded band with a
        // square underline. An inset shadow is painted with the radius, so it
        // turns the corner. `--color-kumo-fill` is the colour Kumo gives the
        // border it replaces; the border keeps its width so nothing shifts.
        "[&_thead[data-compact]_th]:border-b-transparent",
        "[&_thead[data-compact]_th]:shadow-[inset_0_-1px_0_var(--color-kumo-fill)]",
        className,
      )}
    />
  </div>
);
