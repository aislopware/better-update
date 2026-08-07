import { Loader } from "@better-update/ui/components/loader";
import { CheckIcon } from "@phosphor-icons/react";

import type { ReactElement } from "react";

export const renderSwitcherIndicator = (
  isPending: boolean,
  isActive: boolean,
): ReactElement | null => {
  if (isPending) {
    return <Loader size={16} className="text-muted-foreground" />;
  }
  if (isActive) {
    return <CheckIcon weight="bold" className="text-primary size-4" />;
  }
  return null;
};
