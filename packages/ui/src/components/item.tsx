import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import type { ComponentProps } from "react";

import { Separator } from "#/components/separator";
import { cn } from "#/lib/utils";

/**
 * The row of a settings-style list: media, a title/description stack, and
 * trailing actions. Sessions, passkeys, connections, pending invites, update
 * assets and fingerprint rows all use it, which is what keeps them looking like
 * one family.
 *
 * Hand-written: Kumo has no list-row primitive. `LayerCard` is the nearest
 * surface but carries card padding and elevation, which is wrong for a row that
 * repeats twenty times down a page.
 */

/**
 * Vertical stack of `Item`s. Compact rows sit closer together.
 *
 * A layout stack, not a semantic list: rows carry their own headings, links and
 * controls, and interleaving `ItemSeparator`s means the children are not a clean
 * run of list items.
 */
export const ItemGroup = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="item-group"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5", className)}
  />
);

/** Rule between two `Item`s in a group that is not otherwise separated. */
export const ItemSeparator = ({ className, ...props }: ComponentProps<typeof Separator>) => (
  <Separator
    data-slot="item-separator"
    orientation="horizontal"
    // eslint-disable-next-line react/jsx-props-no-spreading -- thin pass-through wrapper
    {...props}
    className={cn("my-2", className)}
  />
);

const ITEM_VARIANTS = {
  default: "border-transparent",
  outline: "border-kumo-hairline",
  muted: "bg-kumo-recessed border-transparent",
} as const;

/**
 * Takes `render` so a whole row can *be* a link without an extra wrapper
 * element around it — the same escape hatch Base UI and Kumo use everywhere.
 */
export const Item = ({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  readonly variant?: keyof typeof ITEM_VARIANTS;
  readonly size?: "default" | "sm";
}) =>
  useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "group/item flex w-full flex-wrap items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
          "focus-visible:ring-kumo-brand outline-none focus-visible:ring-2",
          // Rows that are themselves links pick up a hover surface.
          "[a]:hover:bg-kumo-tint",
          ITEM_VARIANTS[variant],
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: "item", size },
  });

/**
 * Leading slot: an icon, an avatar, a thumbnail. Nudged to the top of a row
 * that has a description, so it aligns with the title rather than floating
 * between the two lines.
 */
export const ItemMedia = ({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { readonly variant?: "default" | "icon" | "image" }) => (
  <div
    data-slot="item-media"
    data-variant={variant}
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn(
      "flex shrink-0 items-center justify-center gap-2",
      "group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start",
      "[&_svg]:pointer-events-none",
      variant === "icon" && "[&_svg:not([class*='size-'])]:size-4",
      variant === "image" &&
        "size-10 overflow-hidden rounded-sm [&_img]:size-full [&_img]:object-cover",
      className,
    )}
  />
);

/** Title/description stack. A second one in the same row sizes to its content. */
export const ItemContent = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="item-content"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none", className)}
  />
);

export const ItemTitle = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="item-title"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn(
      "flex w-fit items-center gap-2 text-sm leading-snug font-medium underline-offset-4",
      className,
    )}
  />
);

export const ItemDescription = ({ className, ...props }: ComponentProps<"p">) => (
  <p
    data-slot="item-description"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain p
    {...props}
    className={cn(
      "text-kumo-subtle line-clamp-2 text-left text-sm leading-normal font-normal",
      "[&>a:hover]:text-kumo-default [&>a]:underline [&>a]:underline-offset-4",
      className,
    )}
  />
);

/** Trailing slot: the buttons and menus that act on the row. */
export const ItemActions = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="item-actions"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn("flex items-center gap-2", className)}
  />
);
