import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
  /** "page" = org-level page title; "sub" = project subpage title (smaller rail). */
  readonly size?: "page" | "sub";
}

/**
 * The single page-level header primitive: title + optional description +
 * right-aligned actions. Use size="sub" inside project subpages; use
 * SectionHeader for sections within a page.
 */
export const PageHeader = ({
  title,
  description,
  actions,
  className,
  size = "page",
}: PageHeaderProps) => (
  <header
    className={cn(
      "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
      size === "page" && "pb-4",
      className,
    )}
  >
    <div className={cn("flex flex-col", size === "page" ? "gap-1.5" : "gap-1")}>
      <h1
        className={cn(
          "font-heading leading-tight font-semibold",
          size === "page" ? "text-2xl tracking-tight" : "text-lg",
        )}
      >
        {title}
      </h1>
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
