import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

/**
 * The facts a detail panel opens with.
 *
 * Detail pages used to spend these two-across inside a card's own padding, which
 * on a full-width panel left a field's value marooned beside half a screen of
 * nothing and pushed the interesting part — the list, the artifact, the manifest
 * — below the fold. The Cloudflare dashboard lays a resource's attributes across
 * the panel in one band, so the whole set is read in a glance rather than
 * scrolled through.
 */

const STRIP_COLUMN_CLASS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
} as const;

export const DetailStatStrip = ({
  columns = 4,
  className,
  children,
}: {
  readonly columns?: 2 | 3 | 4;
  readonly className?: string;
  readonly children: ReactNode;
}) => (
  <div className={cn("grid gap-4 p-4", STRIP_COLUMN_CLASS[columns], className)}>{children}</div>
);

/** One labelled fact in the strip. */
export const DetailStat = ({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) => (
  <div className={cn("flex min-w-0 flex-col gap-1", className)}>
    <span className="text-kumo-subtle text-xs">{label}</span>
    <span className="flex min-w-0 items-center gap-1 text-sm tabular-nums">{children}</span>
  </div>
);
