import {
  TriangleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  CircleXIcon,
} from "lucide-react";
import { Toaster } from "sonner";

import { useTheme } from "./use-theme";

const toasterStyle: React.CSSProperties & Record<`--${string}`, string> = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
  "--border-radius": "var(--radius)",
};

export const ThemedToaster = () => {
  const { resolvedTheme } = useTheme();

  return (
    <Toaster
      theme={resolvedTheme}
      richColors
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon strokeWidth={2} className="size-4" />,
        info: <InfoIcon strokeWidth={2} className="size-4" />,
        warning: <TriangleAlertIcon strokeWidth={2} className="size-4" />,
        error: <CircleXIcon strokeWidth={2} className="size-4" />,
        loading: <LoaderCircleIcon strokeWidth={2} className="size-4 animate-spin" />,
      }}
      style={toasterStyle}
      toastOptions={{ classNames: { toast: "cn-toast" } }}
    />
  );
};
