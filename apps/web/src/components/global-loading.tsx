import { Loader2Icon } from "lucide-react";

import { BrandIcon } from "./brand-mark";

export const GlobalLoading = () => (
  <div
    data-global-loading
    style={{ opacity: 0 }}
    className="bg-background text-foreground fixed inset-0 z-50 flex items-center justify-center"
  >
    <div className="flex flex-col items-center gap-4">
      <BrandIcon size={44} className="text-foreground" />
      <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
    </div>
  </div>
);
