import { KumoPortalProvider } from "@cloudflare/kumo/utils";
import { useState } from "react";

import type { ReactNode } from "react";

/**
 * Gives every Kumo overlay — dialogs, popovers, menus, the command palette — a
 * stacking context that outranks the page.
 *
 * Kumo's overlays declare no z-index of their own and portal to `document.body`,
 * where they lose to any positioned element that does declare one. Its own
 * `InputGroup` input is `relative z-1`, so a palette or popover drawn over a
 * search field disappears behind it. Portalling them into this empty,
 * zero-height div fixes the whole class of collisions in one place.
 *
 * Sits below the toast viewport (`z-100`) on purpose: a toast raised from inside
 * a dialog has to clear that dialog.
 */
export const OverlayPortal = ({ children }: { children: ReactNode }) => {
  // A callback ref, not `useRef`: Base UI reads the portal container while it
  // renders, so a ref object is still `null` at that point and never re-read.
  // State forces the second render that moves the overlays into the div.
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);

  return (
    <>
      <KumoPortalProvider container={layer}>{children}</KumoPortalProvider>
      {/* Fixed, and the whole point is that it is: this empty box is where every
          overlay first mounts, one frame before Base UI has measured its anchor
          and moved it there, and Base UI focuses into the popup on that same
          frame — the palette's search field, a menu's first item. The browser
          duly scrolls to wherever it thinks that element is.

          In flow (`relative`) it was the end of the page, so opening a menu
          threw the reader to the bottom. Out of flow at the document's origin
          (`absolute`) it was the top, which is quieter but still wrong: picking
          a filter from a toolbar halfway down a list snapped the page back to
          its title. Fixed, the mount point is the viewport itself, so there is
          nowhere to scroll to and the page stays where it was left. It also
          gives the positioners inside a viewport-relative origin, which is what
          Base UI's `positionMethod="fixed"` would buy — without every call site
          having to ask for it.

          Zero-sized, so it intercepts nothing; only the popups inside it have
          any area to receive a pointer. */}
      <div ref={setLayer} className="fixed top-0 left-0 z-50" />
    </>
  );
};
