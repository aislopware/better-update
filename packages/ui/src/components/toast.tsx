// Hand-written, unlike its neighbours: Kumo ships `Toasty` plus a manager
// factory, but no default manager and no sonner-shaped `toast.success` /
// `toast.error` sugar. Both live here so callers keep a single import, and so
// code outside the React tree can raise a toast.
import { Toasty, createKumoToastManager } from "@cloudflare/kumo/components/toast";
import { useState } from "react";

import type { ReactNode } from "react";

export { Toast, useKumoToastManager } from "@cloudflare/kumo/components/toast";

export const toastManager = createKumoToastManager();

type ToastOptions = Omit<Parameters<typeof toastManager.add>[0], "title" | "variant">;

// Reach for `toastManager` directly for anything past these two — it also
// carries `promise()`, `update()` and the `info` / `warning` variants.
export const toast = {
  success: (title: ReactNode, options?: ToastOptions): void => {
    toastManager.add({ ...options, title, variant: "success" });
  },
  error: (title: ReactNode, options?: ToastOptions): void => {
    toastManager.add({ ...options, title, variant: "error" });
  },
};

export const Toaster = ({ children }: { children: ReactNode }) => {
  // A callback ref, not `useRef`: Base UI reads the portal container while it
  // renders, so a ref object is still `null` at that point and never re-read.
  // State forces the second render that moves the viewport into the div.
  const [stack, setStack] = useState<HTMLDivElement | null>(null);

  return (
    <>
      <Toasty toastManager={toastManager} container={stack}>
        {children}
      </Toasty>
      {/* Kumo pins its toast viewport at `z-1`, which loses to any overlay
          declaring a higher one — a toast raised from inside a dialog would sit
          behind that dialog's backdrop. Portalling into this empty, zero-height
          div hands the viewport a stacking context that outranks them.

          The marker attribute is what the reduced-motion rule hangs off: Kumo
          writes the half-second stack transition as an inline arbitrary value
          on a Base UI root that carries no stable class of its own, so this
          container is the only handle on the whole viewport. */}
      <div ref={setStack} data-toast-stack className="relative z-100" />
    </>
  );
};
