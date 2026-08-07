// Hand-written, unlike its neighbours: Kumo's `LayerCard` is the surface only —
// the ring, the radius and the shadow — and leaves the interior to the caller,
// which is why its own examples pad it inline. Composing it once here keeps the
// app's existing card anatomy (header, content, footer, an action parked in the
// header's top-right) on top of Kumo's surface, so a card reads the same
// wherever it appears.
import { LayerCard } from "@cloudflare/kumo/components/layer-card";

import { cn } from "#/lib/utils";

import type { ComponentProps } from "react";

/**
 * Card surface. Lays its children out as a vertical stack with the side padding
 * left to `CardHeader` / `CardContent`, so a footer or an image can reach the
 * edges.
 */
export const Card = ({ className, ...props }: ComponentProps<typeof LayerCard>) => (
  <LayerCard
    data-slot="card"
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Kumo's LayerCard
    {...props}
    className={cn(
      // A footer supplies its own bottom padding and has to reach the edge, so
      // the card's own drops out when one is present.
      "text-kumo-default flex flex-col gap-4 py-4 text-sm has-[[data-slot=card-footer]]:pb-0",
      className,
    )}
  />
);

/**
 * Title/description block. A grid rather than a stack so `CardAction` can sit
 * in a second column spanning both rows without being taken out of flow.
 */
export const CardHeader = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-header"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn(
      "grid auto-rows-min items-start gap-1 px-4 has-[[data-slot=card-action]]:grid-cols-[1fr_auto] has-[[data-slot=card-description]]:grid-rows-[auto_auto]",
      className,
    )}
  />
);

export const CardTitle = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-title"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("text-kumo-strong text-base leading-snug font-medium", className)}
  />
);

export const CardDescription = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-description"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("text-kumo-subtle text-sm", className)}
  />
);

/** Controls that belong to the card as a whole — parked top-right of the header. */
export const CardAction = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-action"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
  />
);

export const CardContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-content"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("px-4", className)}
  />
);

/** Full-bleed bar closing the card, tinted so it reads as separate from the body. */
export const CardFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="card-footer"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("border-kumo-line bg-kumo-tint flex items-center border-t p-4", className)}
  />
);
