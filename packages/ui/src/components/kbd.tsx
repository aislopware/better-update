import type { ComponentProps } from "react";

import { cn } from "#/lib/utils";

/**
 * A keycap: the `⌘K` in the search field, the `↵ / ↑↓ / esc` legend under the
 * command palette.
 *
 * Hand-written: Kumo has no keycap. Its `DropdownMenu.Shortcut` is bare text at
 * 60% opacity, which reads as a hint beside a menu label but not as a key you
 * can press. This keeps the pressed-cap shape (recessed fill, inset bottom
 * edge) on Kumo's tokens.
 */
export const Kbd = ({ className, ...props }: ComponentProps<"kbd">) => (
  <kbd
    data-slot="kbd"
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over a plain kbd
    {...props}
    className={cn(
      "border-kumo-line bg-kumo-recessed text-kumo-subtle pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border px-1 font-sans text-xs font-medium select-none",
      "shadow-[inset_0_-1px_0_var(--color-kumo-hairline)]",
      "[&_svg:not([class*='size-'])]:size-3",
      className,
    )}
  />
);
