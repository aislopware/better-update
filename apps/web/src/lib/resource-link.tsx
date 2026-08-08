import { linkVariants } from "@better-update/ui/components/link";
import { cn } from "@better-update/ui/lib/utils";
import { createLink } from "@tanstack/react-router";
import { forwardRef } from "react";

import type { KumoLinkVariant } from "@better-update/ui/components/link";
import type { ComponentPropsWithoutRef } from "react";

/**
 * A router link wearing Kumo's link skin.
 *
 * A link sitting in a field had nothing to say it was one: the same weight and
 * colour as the id beside it, and an underline that only appeared once the
 * pointer was already on top of it. Each page had also arrived at its own
 * answer, so the same navigation looked different depending on where you met
 * it. Kumo's `plain` variant is the dashboard's own: link colour, no underline,
 * which reads as a destination among values without turning a card of facts
 * into a page of underlines.
 *
 * A whole row that navigates is not this — the row says so with its hover and
 * its caret, and painting the name as well would make every table a wall of
 * link colour.
 *
 * Kumo's `Link` takes a plain `href`, which throws away TanStack's route typing;
 * `createLink` over an anchor that borrows `linkVariants()` keeps both.
 */
interface ResourceLinkAnchorProps extends Omit<ComponentPropsWithoutRef<"a">, "children"> {
  readonly variant?: KumoLinkVariant;
}

const ResourceLinkAnchor = forwardRef<HTMLAnchorElement, ResourceLinkAnchorProps>(
  ({ variant = "plain", className, ...props }, ref) => (
    // eslint-disable-next-line jsx-a11y/anchor-has-content -- children arrive through the spread below
    <a
      ref={ref}
      className={cn(linkVariants({ variant }), className)}
      // eslint-disable-next-line react/jsx-props-no-spreading -- thin styling wrapper over the anchor createLink hands us
      {...props}
    />
  ),
);

ResourceLinkAnchor.displayName = "ResourceLinkAnchor";

export const RouterLink = createLink(ResourceLinkAnchor);
