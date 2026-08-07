// Hand-written, unlike its neighbours: Kumo's `Dialog` is only the popup — no
// header, no footer, no dismiss control and no padding, so every example in its
// own docs hand-rolls that chrome. Composing it once here keeps the call sites
// free of layout boilerplate and gives every dialog the same anatomy: a header
// pinned to the top carrying the title and the dismiss control, a body that
// scrolls on its own, and a footer bar that stays reachable however tall that
// body grows.
import {
  DialogDescription as KumoDialogDescription,
  Dialog as KumoDialogPopup,
  DialogTitle as KumoDialogTitle,
  DialogClose,
  DialogRoot,
} from "@cloudflare/kumo/components/dialog";
import { XIcon } from "@phosphor-icons/react";

import type {
  DialogDescriptionProps,
  DialogProps as KumoDialogPopupProps,
  DialogTitleProps,
} from "@cloudflare/kumo/components/dialog";
import type { ComponentProps } from "react";

import { Button } from "#/components/button";
import { cn } from "#/lib/utils";

export { DialogClose, DialogTrigger } from "@cloudflare/kumo/components/dialog";
export type {
  DialogCloseProps,
  DialogProps as DialogContentProps,
  DialogRootProps as DialogProps,
  DialogTriggerProps,
} from "@cloudflare/kumo/components/dialog";

/**
 * Dialog root. Pass `role="alertdialog"` for confirmation flows that must not be
 * dismissed by clicking outside.
 */
export const Dialog = DialogRoot;

/**
 * The popup itself. Widths come from Kumo's `size`: sm 288px, base 384px,
 * lg 512px, xl 768px.
 *
 * The scroll region is a wrapper rather than the popup so Kumo's own
 * `overflow-hidden` keeps clipping to the rounded corners, and so the padding
 * the header and footer escape from with negative margins is unambiguous.
 * Content stays a flat list of children, which is what lets call sites keep
 * wrapping a whole dialog in a `display: contents` form.
 */
export const DialogContent = ({ className, children, ...props }: KumoDialogPopupProps) => (
  <KumoDialogPopup
    // eslint-disable-next-line react/jsx-props-no-spreading -- chrome wrapper over Kumo's Dialog popup
    {...props}
    // The cap keeps a tall dialog inside the viewport rather than running off
    // both ends of it.
    className={cn("flex max-h-[calc(100dvh-4rem)] flex-col text-sm", className)}
  >
    <div
      data-slot="dialog-body"
      // The bottom padding is the dialog's own; a footer supplies its own and
      // has to reach the popup edge, so it drops out when one is present.
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 has-[[data-slot=dialog-footer]]:pb-0"
    >
      {children}
    </div>
  </KumoDialogPopup>
);

/**
 * Title/description block. Sticks to the top of the scroll region and bleeds
 * out of its padding, so a long body slides under an opaque header rather than
 * past a floating one. Owns the dismiss button: `absolute` would scroll away
 * with the body.
 */
export const DialogHeader = ({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<"div"> & {
  /** Hide the dismiss button for flows that demand an explicit answer. */
  readonly showCloseButton?: boolean;
}) => (
  <div
    data-slot="dialog-header"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn(
      "bg-kumo-base sticky top-0 z-1 -mx-5 flex shrink-0 items-start justify-between gap-4 px-5 pt-5 pb-2",
      className,
    )}
  >
    <div className="grid gap-1.5">{children}</div>
    {showCloseButton ? (
      <DialogClose
        render={
          <Button
            variant="ghost"
            shape="square"
            size="sm"
            className="-mt-0.5 -mr-1.5"
            aria-label="Close"
            icon={XIcon}
          />
        }
      />
    ) : null}
  </div>
);

/**
 * Action bar. Sticks to the bottom of the scroll region and bleeds out of its
 * side padding, so it reads as a bar across the popup rather than a floating row.
 */
export const DialogFooter = ({ className, ...props }: ComponentProps<"div">) => (
  <div
    data-slot="dialog-footer"
    // eslint-disable-next-line react/jsx-props-no-spreading -- layout primitive over a plain div
    {...props}
    className={cn(
      "border-kumo-line bg-kumo-tint sticky bottom-0 z-1 -mx-5 flex shrink-0 flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end",
      className,
    )}
  />
);

export const DialogTitle = ({ className, ...props }: DialogTitleProps) => (
  <KumoDialogTitle
    // eslint-disable-next-line react/jsx-props-no-spreading -- Kumo leaves its Base UI title unstyled
    {...props}
    className={cn("text-kumo-strong text-base leading-none font-medium", className)}
  />
);

export const DialogDescription = ({ className, ...props }: DialogDescriptionProps) => (
  <KumoDialogDescription
    // eslint-disable-next-line react/jsx-props-no-spreading -- Kumo leaves its Base UI description unstyled
    {...props}
    className={cn(
      "text-kumo-subtle *:[a]:hover:text-kumo-strong text-sm *:[a]:underline *:[a]:underline-offset-3",
      className,
    )}
  />
);
