import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

type StatusTone = "success" | "warning" | "info" | "destructive" | "muted";

const DOT_TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground/60",
};

/**
 * Geist-style lifecycle indicator: colored dot + plain label. `pulse` is for
 * non-terminal states (an active rollout) — the dot itself is the spinner, so
 * never pair it with a separate one. Color never carries the state alone; the
 * label always names it.
 */
export const StatusDot = ({
  tone,
  pulse = false,
  children,
  className,
}: {
  tone: StatusTone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}) => (
  <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
    <span className="relative flex size-2 shrink-0">
      {pulse ? (
        <span
          aria-hidden
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            DOT_TONE_CLASSES[tone],
          )}
        />
      ) : null}
      <span
        aria-hidden
        className={cn("relative inline-flex size-2 rounded-full", DOT_TONE_CLASSES[tone])}
      />
    </span>
    {children}
  </span>
);
