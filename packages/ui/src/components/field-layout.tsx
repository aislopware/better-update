// Kumo's `Field` covers one control — label, description, error. It has no
// opinion on how several of them stack, so the surrounding layout lives here:
// a group that spaces sibling fields, and a fieldset/legend pair for forms long
// enough to need headings. Everything is drawn from Kumo tokens so these sit
// flush against the controls they wrap.
import { cn } from "#/lib/utils";

import type { ComponentProps } from "react";

/** Vertical stack of `Field`s. Nested groups tighten up, so subsections read as one block. */
export const FieldGroup = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="field-group"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("flex w-full flex-col gap-5 *:data-[slot=field-group]:gap-4", className)}
  />
);

/** A titled section of a form. Pair with `FieldLegend`. */
export const FieldSet = ({ className, ...props }: ComponentProps<"fieldset">) => (
  <fieldset
    data-slot="field-set"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain fieldset
    {...props}
    className={cn("flex flex-col gap-4", className)}
  />
);

/** Heading for a `FieldSet`. */
export const FieldLegend = ({ className, ...props }: ComponentProps<"legend">) => (
  <legend
    data-slot="field-legend"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain legend
    {...props}
    className={cn("text-kumo-default mb-1.5 text-base font-medium", className)}
  />
);

/** Explanatory copy under a `FieldLegend`, matching Kumo's own field descriptions. */
export const FieldSetDescription = ({ className, ...props }: ComponentProps<"p">) => (
  <p
    data-slot="field-set-description"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain paragraph
    {...props}
    className={cn("text-kumo-subtle text-sm leading-snug", className)}
  />
);

/** Rule between two `FieldSet`s. */
export const FieldSeparator = ({ className, ...props }: ComponentProps<"hr">) => (
  <hr
    data-slot="field-separator"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain rule
    {...props}
    className={cn("border-kumo-line -my-1 border-t", className)}
  />
);
