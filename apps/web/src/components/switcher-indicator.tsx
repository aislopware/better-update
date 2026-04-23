import { CheckIcon, Loader2Icon } from "lucide-react";

import type { ReactElement } from "react";

export const renderSwitcherIndicator = (
  isPending: boolean,
  isActive: boolean,
): ReactElement | null => {
  if (isPending) {
    return <Loader2Icon className="text-muted-foreground size-4 animate-spin" />;
  }
  if (isActive) {
    return <CheckIcon strokeWidth={2} className="text-primary size-4" />;
  }
  return null;
};
