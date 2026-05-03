import { AnchoredToastProvider, ToastProvider } from "@better-update/ui/components/ui/toast";

import type { ToastPosition } from "@better-update/ui/components/ui/toast";
import type { ReactNode } from "react";

interface ThemedToasterProps {
  children: ReactNode;
  position?: ToastPosition;
}

export const ThemedToaster = ({ children, position = "bottom-right" }: ThemedToasterProps) => (
  <ToastProvider position={position}>
    <AnchoredToastProvider>{children}</AnchoredToastProvider>
  </ToastProvider>
);
