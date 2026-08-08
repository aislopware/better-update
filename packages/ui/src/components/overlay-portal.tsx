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
      {/* Out of flow, at the document's origin. It used to be `relative`, which
          left a zero-height box in normal flow at the very end of the page —
          and that is where an overlay first mounts, before Base UI's positioner
          has moved it onto its anchor. A popover that autofocuses its search
          field then had the browser scroll that field into view, throwing the
          page to the bottom before the popover jumped back up to the trigger.
          Absolute takes the box out of flow entirely, so the mount point is the
          top of the document and there is nothing to scroll to. */}
      <div ref={setLayer} className="absolute top-0 left-0 z-50" />
    </>
  );
};
