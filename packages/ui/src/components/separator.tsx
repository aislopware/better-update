// Hand-written, unlike its generated neighbours: Kumo re-exports Base UI's
// `Separator` unstyled, so a bare pass-through would render a zero-height
// element. The rule below is the one Kumo draws inside its own menus
// (`h-px bg-kumo-hairline`), lifted out so page- and toolbar-level dividers
// match the ones the popups already draw.
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "#/lib/utils";

/**
 * A hairline rule between sibling regions. Vertical separators stretch to the
 * flex line by default; give them an explicit height (`h-4`) when they sit
 * beside text rather than spanning a row.
 */
export const Separator = ({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) => (
  <SeparatorPrimitive
    data-slot="separator"
    orientation={orientation}
    className={cn(
      "bg-kumo-hairline shrink-0",
      "data-horizontal:h-px data-horizontal:w-full",
      "data-vertical:w-px data-vertical:self-stretch",
      className,
    )}
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Base UI's Separator
    {...props}
  />
);
