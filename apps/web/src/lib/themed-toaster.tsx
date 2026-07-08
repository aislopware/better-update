import { Toaster } from "@better-update/ui/components/ui/sonner";
import { use } from "react";

import type { ToasterProps } from "@better-update/ui/components/ui/sonner";
import type { ReactNode } from "react";

import { ThemeContext } from "./theme-context-value";

interface ThemedToasterProps {
  children: ReactNode;
  position?: ToasterProps["position"];
}

export const ThemedToaster = ({ children, position = "bottom-right" }: ThemedToasterProps) => {
  const themeContext = use(ThemeContext);
  return (
    <>
      {children}
      <Toaster position={position} theme={themeContext?.resolvedTheme ?? "system"} />
    </>
  );
};
