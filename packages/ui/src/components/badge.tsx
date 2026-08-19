// Hand-written, unlike its neighbours: Kumo 2.11 made two changes to the pill
// that only read correctly on a page whose surfaces stay put, and this app's
// do not.
//
// It rings a badge whenever an ancestor link is hovered
// (`[a:hover_&]:ring`), which is the affordance for a badge that is itself a
// link. None of ours are — they are status markers, and the surface under them
// is what carries the link: a project card is one big anchor, a table's name
// cell wraps its content in the row's link. So the ring fired on hovering the
// row and drew a box around a word nothing happens to when you click it. The
// row already has a hover state of its own.
//
// And it fills the outline variant with the base surface colour instead of
// leaving it transparent. An outline badge here sits on surfaces that are not
// the base one — inside an alert Banner, on a table row while it is tinted by
// hover — where an opaque fill punches a white pill out of the colour around
// it. Transparent is what let the quietest badge stay quiet anywhere.
import { Badge as KumoBadge } from "@cloudflare/kumo/components/badge";

import type { ComponentProps } from "react";

import { cn } from "#/lib/utils";

export type { BadgeVariant } from "@cloudflare/kumo/components/badge";

/** Kumo's badge, minus the linked-badge ring and the opaque outline fill. */
export const Badge = ({ className, ...props }: ComponentProps<typeof KumoBadge>) => (
  <KumoBadge
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Kumo's Badge
    {...props}
    className={cn(
      "[a:hover_&]:ring-0",
      props.variant === "outline" ? "bg-transparent" : undefined,
      className,
    )}
  />
);
