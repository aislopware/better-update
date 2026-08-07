import type { ComponentProps } from "react";

import { cn } from "#/lib/utils";

/**
 * A placeholder holding the space its content will occupy. Size it with the
 * same classes as the real element (`h-4 w-32`, `size-9`, …) so nothing shifts
 * when the data lands.
 *
 * Hand-written, unlike its neighbours: Kumo has no block placeholder. Its
 * `SkeletonLine` is a fixed-height text line whose width is drawn from
 * `Math.random()` — under SSR that renders one width on the server and another
 * on the client, and it cannot stand in for the card, chart and avatar shapes
 * the app reserves space for. The shimmer matches Kumo's own: a highlight
 * sweeping across a recessed fill.
 */
export const Skeleton = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="skeleton"
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over a plain div
    {...props}
    className={cn(
      "bg-kumo-fill relative overflow-hidden rounded-md",
      // `kumo-contrast` inverts with the theme — dark in light mode, light in
      // dark — so one highlight reads on both.
      "after:animate-shimmer after:via-kumo-contrast/8 after:absolute after:inset-0 after:bg-gradient-to-r after:from-transparent after:to-transparent",
      "motion-reduce:after:animate-none",
      className,
    )}
  />
);
