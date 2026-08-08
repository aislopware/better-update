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
}) => <Card className={cn("gap-0 py-0", className)}>{children}</Card>;

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
  <CardHeader className="border-kumo-line border-b py-4">
    <CardTitle>{title}</CardTitle>
    {description ? <CardDescription>{description}</CardDescription> : null}
    {actions ? <CardAction className="flex items-center gap-2">{actions}</CardAction> : null}
  </CardHeader>
);

/** Closing bar of a `ListPanel` — the count, and page controls when there are pages. */
export const ListPanelFooter = ({ children }: { children: ReactNode }) => (
  <CardFooter>{children}</CardFooter>
);
