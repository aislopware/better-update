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
      "gap-0 py-0",
      // A table closes itself: its last row draws the rule under the island and
      // curves it round the corners. The footer's own straight border would run
      // across those curves a pixel below, so it stands down when a table is
      // what it follows. A list of `Item`s has no such edge and keeps it.
      "[&>[data-slot=table-container]_+_[data-slot=card-footer]]:border-t-0",
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
  // fill as the rows under it reads as the first of them. The fill is what
  // makes the rows an island rather than the whole card being one surface.
  <CardHeader className="border-kumo-line bg-kumo-elevated border-b py-4">
    <CardTitle>{title}</CardTitle>
    {description ? <CardDescription>{description}</CardDescription> : null}
    {actions ? <CardAction className="flex items-center gap-2">{actions}</CardAction> : null}
  </CardHeader>
);

/** Closing bar of a `ListPanel` — the count, and page controls when there are pages. */
export const ListPanelFooter = ({ children }: { children: ReactNode }) => (
  // A panel's two chrome bands are one surface interrupted by the list, so the
  // closing bar takes the same fill as the table's header band rather than the
  // card's generic footer tint. In light they are a shade apart and it reads as
  // sloppiness; in dark the tint is far lighter than the base and the panel
  // ended on a bar brighter than anything above it.
  <CardFooter className="bg-kumo-elevated">{children}</CardFooter>
);
