import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";
import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

/**
 * Draws the island — everything the panel lists, as one page-coloured slab with
 * curved ends, set into the card's chrome.
 *
 * A panel is chrome plus what it holds, and the fill is what says which is
 * which: the title bar, a table's column band and the closing bar share the
 * card's own surface, and the rows sit on the page's. Tables already build this
 * for themselves out of their cells, so a table container is left alone here.
 *
 * The body is not one element. A panel's children are a run — a note, a warning
 * strip, twenty rows — with chrome above and below, so "the island" is that run
 * taken together: every child in it takes the fill, and the two on the ends take
 * the curve. Writing it as a selector rather than a wrapper component is what
 * keeps the shape a property of the panel, so a body of rows and a body of one
 * paragraph come out the same and a new panel cannot forget.
 *
 * Base UI's focus guards are excluded along with the chrome: opening a menu
 * inside a row inserts weightless spans that would otherwise be counted as part
 * of the run. Spelled out in full because Tailwind reads class names as
 * literals, so the "is one of the things listed" test is repeated in each.
 */
const ISLAND = [
  // The fill, on every child of the run, and the colour of the rules its ends
  // draw. Clipped, so a row's own fill — a hover, a menu left open — ends on the
  // curve instead of squaring off the corner under it.
  "[&>:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns])]:bg-kumo-base",
  "[&>:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns])]:border-kumo-fill",
  "[&>:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns])]:overflow-hidden",
  // The ends of the run carry the curve: the first child with no listed thing
  // before it, the last with none after it.
  "[&>:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns]):not(:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns])_+_*)]:rounded-t-lg",
  "[&>:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns]):not(:has(+_:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns])))]:rounded-b-lg",
  // …and the rule where the island meets chrome, drawn by the island so that it
  // follows the curve rather than cutting across the pocket. Only where there is
  // chrome to meet: against the card's own ring it would be a second hairline a
  // pixel below the first.
  "[&>[data-slot=card-header]_+_:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns])]:border-t",
  "[&>:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns]):has(+_[data-slot=card-footer])]:border-b",
  // Which leaves the chrome to stand its own rules down where the island has
  // taken them over. A table closes itself the same way, out of its last row.
  "[&>[data-slot=card-header]:has(+_:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns]))]:border-b-0",
  "[&>:not([data-slot=card-header]):not([data-slot=card-footer]):not([data-slot=table-container]):not([data-base-ui-focus-guard]):not([aria-owns])_+_[data-slot=card-footer]]:border-t-0",
  "[&>[data-slot=table-container]_+_[data-slot=card-footer]]:border-t-0",
].join(" ");

/**
 * The frame every list sits in: a card whose own padding steps out of the way so
 * rows reach the edges, with dividers doing the separating instead.
 *
 * Lists used to be a bare bordered box with the count line floating underneath
 * it; the Cloudflare dashboard keeps the rows and their count inside one frame,
 * which is what makes a page of lists read as panels rather than as fragments.
 */
export const ListPanel = ({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) => (
  <Card
    className={cn(
      // The card is the chrome — the surface the title bar, the column band and
      // the closing bar all sit on. What the panel lists is an island on top of
      // it, so this colour is only ever seen at the panel's own edges and in the
      // pockets the island's corners leave behind.
      "bg-kumo-elevated gap-0 py-0",
      ISLAND,
      className,
    )}
  >
    {children}
  </Card>
);

/**
 * Opening bar of a `ListPanel` — what the rows below it are, and any control
 * over the list as a whole. Carries the divider itself, so an empty body still
 * reads as a panel with nothing in it.
 */
export const ListPanelHeader = ({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) => (
  // Chrome, like the closing bar and like a table's column band: what a panel
  // is called is not one of the things it lists, and a title set on the same
  // fill as the rows under it reads as the first of them. The fill comes from
  // the card, which is chrome all the way down; the rule is here because a
  // column band has none of its own, and stands down when an island follows.
  <CardHeader className="border-kumo-line border-b py-4">
    <CardTitle>{title}</CardTitle>
    {description ? <CardDescription>{description}</CardDescription> : null}
    {actions ? <CardAction className="flex items-center gap-2">{actions}</CardAction> : null}
  </CardHeader>
);

/**
 * A row of a settings-style list: a mark, what the row is and one line about
 * it, and the controls that act on it.
 *
 * Sessions, passkeys, connections and pending invites are the same row wearing
 * four different icons, and all four had written it out themselves — down to the
 * same four utilities on the same four spans. The one that had not, invites,
 * had drifted: rounded row cards inside a hand-built panel, separated by
 * elements rather than by the rule a row draws under itself.
 */
export const ListPanelRow = ({
  media,
  title,
  description,
  actions,
}: {
  /** Leading mark — an icon, sized and toned by the row. */
  media?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) => (
  <div className="border-kumo-line flex items-center gap-3 border-b px-4 py-3 last:border-0">
    {media ? (
      <span className="text-kumo-subtle flex shrink-0 items-center [&>svg]:size-4">{media}</span>
    ) : null}
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">{title}</span>
      {description ? (
        <span className="text-kumo-subtle truncate text-xs">{description}</span>
      ) : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);

/** Closing bar of a `ListPanel` — the count, and page controls when there are pages. */
export const ListPanelFooter = ({ children }: { children: ReactNode }) => (
  // A panel's chrome is one surface interrupted by the island, so the closing
  // bar drops the card's generic footer tint back to it. In light the two are a
  // shade apart and it reads as sloppiness; in dark the tint is far lighter
  // than the base and the panel ended on a bar brighter than anything above it.
  <CardFooter className="bg-kumo-elevated">{children}</CardFooter>
);
