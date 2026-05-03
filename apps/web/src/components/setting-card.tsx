import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

interface SettingCardProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
}

export const SettingCard = ({
  title,
  description,
  action,
  children,
  footer,
  className,
}: SettingCardProps) => (
  <section
    className={cn(
      "bg-card text-card-foreground relative flex flex-col gap-4 rounded-2xl border p-6 shadow-xs/5 not-dark:bg-clip-padding",
      "before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)]",
      "dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
      className,
    )}
  >
    <header className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base leading-none font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
    {children ? <div className="flex flex-col gap-4">{children}</div> : null}
    {footer ? (
      <footer className="bg-muted/72 -mx-6 mt-2 -mb-6 flex items-center justify-end gap-2 rounded-b-[calc(var(--radius-2xl)-1px)] border-t px-6 py-3">
        {footer}
      </footer>
    ) : null}
  </section>
);
