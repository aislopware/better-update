import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

type MedallionTone = "neutral" | "warning" | "success" | "destructive";

const TONE_CLASSES: Record<MedallionTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-warning/10 text-warning-foreground",
  success: "bg-success/10 text-success-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

/**
 * The one "big status icon" language for first-impression surfaces (pending
 * approval, invitation states, CLI login results): a centered medallion whose
 * fill names the tone. Color never carries the state alone — always pair it
 * with a title that states the status in words.
 */
export const StatusMedallion = ({
  tone = "neutral",
  children,
  className,
}: {
  tone?: MedallionTone;
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex size-12 shrink-0 items-center justify-center rounded-full [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6",
      TONE_CLASSES[tone],
      className,
    )}
  >
    {children}
  </div>
);
