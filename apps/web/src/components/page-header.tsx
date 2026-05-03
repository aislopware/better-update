import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export const PageHeader = ({ title, description, actions, className }: PageHeaderProps) => (
  <header
    className={cn(
      "flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
      className,
    )}
  >
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </header>
);

interface SectionHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export const SectionHeader = ({ title, description, actions, className }: SectionHeaderProps) => (
  <div
    className={cn(
      "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
      className,
    )}
  >
    <div className="flex flex-col gap-1">
      <h2 className="font-heading text-base leading-none font-semibold">{title}</h2>
      {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);
