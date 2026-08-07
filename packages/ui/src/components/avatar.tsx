import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

import { cn } from "#/lib/utils";

/**
 * Identity chip for a user, an org or a project.
 *
 * Hand-written: Kumo ships no avatar at all — the Cloudflare dashboard uses
 * initials on a generated colour, which is exactly what `lib/entity-avatar`
 * composes on top of this. The hairline is drawn as an `::after` ring rather
 * than a border so it sits over the image instead of shrinking it, and blends
 * so a light image keeps a visible edge without a hard line on a dark one.
 */
export const Avatar = ({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & { readonly size?: "default" | "sm" | "lg" }) => (
  <AvatarPrimitive.Root
    data-slot="avatar"
    data-size={size}
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Base UI's Avatar
    {...props}
    className={cn(
      "group/avatar relative flex size-8 shrink-0 rounded-full select-none",
      "after:border-kumo-hairline after:absolute after:inset-0 after:rounded-full after:border after:mix-blend-darken dark:after:mix-blend-lighten",
      "data-[size=lg]:size-10 data-[size=sm]:size-6",
      className,
    )}
  />
);

export const AvatarImage = ({ className, ...props }: AvatarPrimitive.Image.Props) => (
  <AvatarPrimitive.Image
    data-slot="avatar-image"
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Base UI's Avatar
    {...props}
    className={cn("aspect-square size-full rounded-full object-cover", className)}
  />
);

/** Shown until the image loads, and permanently when there is none. */
export const AvatarFallback = ({ className, ...props }: AvatarPrimitive.Fallback.Props) => (
  <AvatarPrimitive.Fallback
    data-slot="avatar-fallback"
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Base UI's Avatar
    {...props}
    className={cn(
      "bg-kumo-recessed text-kumo-subtle flex size-full items-center justify-center rounded-full text-sm",
      "group-data-[size=sm]/avatar:text-xs",
      className,
    )}
  />
);
