import { compact } from "@better-update/type-guards";
import { buttonVariants } from "@better-update/ui/components/button";
import { cn } from "@better-update/ui/lib/utils";
import { createLink } from "@tanstack/react-router";
import { forwardRef } from "react";

import type { ComponentPropsWithoutRef } from "react";

/**
 * A router link wearing Kumo's button skin.
 *
 * Kumo's own `LinkButton` takes a plain `href`, which throws away TanStack's
 * route typing — no `params`, no compile-time check that the path exists. This
 * keeps both by handing `createLink` an anchor that borrows `buttonVariants()`.
 *
 * `primary` and `destructive` are deliberately absent: Kumo paints those two
 * with a gradient overlay and inline custom properties that live inside its
 * `Button`, so a bare anchor cannot reproduce them. Reach for Kumo's
 * `LinkButton` when a link really is the page's primary call to action.
 */
type ButtonSkin = Exclude<
  NonNullable<Parameters<typeof buttonVariants>[0]>["variant"],
  "primary" | "destructive"
>;

interface LinkButtonAnchorProps extends Omit<ComponentPropsWithoutRef<"a">, "children"> {
  readonly variant?: ButtonSkin;
  readonly size?: NonNullable<Parameters<typeof buttonVariants>[0]>["size"];
  readonly shape?: NonNullable<Parameters<typeof buttonVariants>[0]>["shape"];
}

const LinkButtonAnchor = forwardRef<HTMLAnchorElement, LinkButtonAnchorProps>(
  ({ variant = "secondary", size, shape, className, ...props }, ref) => (
    // eslint-disable-next-line jsx-a11y/anchor-has-content -- children arrive through the spread below
    <a
      ref={ref}
      className={cn(buttonVariants(compact({ variant, size, shape })), className)}
      // eslint-disable-next-line react/jsx-props-no-spreading -- thin styling wrapper over the anchor createLink hands us
      {...props}
    />
  ),
);

LinkButtonAnchor.displayName = "LinkButtonAnchor";

export const RouterLinkButton = createLink(LinkButtonAnchor);
