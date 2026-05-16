import { Spinner } from "@better-update/ui/components/ui/spinner";
import { CheckIcon } from "lucide-react";

import type { ReactElement } from "react";

export const renderSwitcherIndicator = (
  isPending: boolean,
  isActive: boolean,
): ReactElement | null => {
  if (isPending) {
    return <Spinner className="text-muted-foreground size-4" />;
  }
  if (isActive) {
    return <CheckIcon strokeWidth={2} className="text-primary size-4" />;
  }
  return null;
};
