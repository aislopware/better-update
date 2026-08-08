import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * The single page-level header primitive: title + optional description +
 * right-aligned actions. Use SectionHeader for sections within a page.
 *
 * One size, at every depth. A project's Builds page used to draw its title two
 * steps smaller than the org's Projects page, from when project pages sat under
 * a project header with tabs. The nav carries that context now, so a project
 * subpage is a page like any other — and a heading that shrinks with depth reads
 * as a sub-section of something the page no longer sits inside.
 */
export const PageHeader = ({ title, description, actions, className }: PageHeaderProps) => (
  <header
    className={cn(
      "flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
      className,
    )}
  >
    <div className="flex flex-col gap-1.5">
      {/* No `tracking-*`: Kumo's type is drawn at its natural spacing, and
          tightening a heading against untouched body text reads as a mismatch
          rather than as emphasis. */}
      <h1 className="font-heading text-3xl leading-tight font-semibold">{title}</h1>
      {description ? (
        // 16px under a 30px title, which is the step Kumo's own page block
        // draws: a page's one line of description is not body copy, it is the
        // second half of the heading.
        <p className="text-kumo-subtle text-lg">{description}</p>
      ) : null}
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
      {description ? <p className="text-kumo-subtle text-sm">{description}</p> : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </div>
);
