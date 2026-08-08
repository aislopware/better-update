import { Card, CardFooter } from "@better-update/ui/components/card";
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
}) => <Card className={cn("gap-0 py-0", className)}>{children}</Card>;

/** Closing bar of a `ListPanel` — the count, and page controls when there are pages. */
export const ListPanelFooter = ({ children }: { children: ReactNode }) => (
  <CardFooter>{children}</CardFooter>
);
