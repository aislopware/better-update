import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { cn } from "@better-update/ui/lib/utils";

import type { ComponentProps, ReactNode } from "react";

interface DetailHeaderProps {
  /** Entity name — single line, truncates with a hover tooltip when a string. */
  readonly title: ReactNode;
  /** Inline badges after the title (Built-in, Rollback, …). */
  readonly badges?: ReactNode;
  /**
   * Meta row under the title: mono id chips (CopyableId/CopyableMono),
   * StatusDot/Badge, and timestamps composed as one readable sentence.
   */
  readonly meta?: ReactNode;
  /** Right-aligned actions; place the primary action rightmost. */
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * The single header primitive for entity detail pages (channel, update, build,
 * runtime, fingerprint, submission): truncating title + badges, a quiet meta
 * sentence, and a trailing actions slot. Use PageHeader for list/settings
 * pages; use DetailNotFound below for the matching not-found state.
 */
export const DetailHeader = ({ title, badges, meta, actions, className }: DetailHeaderProps) => (
  <header className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
    <div className="flex min-w-0 flex-col gap-1.5">
      <h1 className="font-heading flex min-w-0 items-center gap-2 text-xl leading-tight font-semibold tracking-tight">
        <span className="min-w-0 truncate" title={typeof title === "string" ? title : undefined}>
          {title}
        </span>
        {badges ? <span className="flex shrink-0 items-center gap-2">{badges}</span> : null}
      </h1>
      {meta ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm tabular-nums">
          {meta}
        </div>
      ) : null}
    </div>
    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
  </header>
);

interface DetailNotFoundProps {
  /** Entity icon, e.g. `<RadioTowerIcon strokeWidth={1.5} />`. */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  /** Back-navigation Link element passed to the Button `render` prop. */
  readonly backLink?: NonNullable<ComponentProps<typeof Button>["render"]>;
  readonly backLabel?: ReactNode;
}

/** Shared not-found state for entity detail pages: icon Empty inside a Card. */
export const DetailNotFound = ({
  icon,
  title,
  description,
  backLink,
  backLabel,
}: DetailNotFoundProps) => (
  <Card>
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {backLink ? (
        <EmptyContent>
          <Button variant="outline" render={backLink}>
            {backLabel}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  </Card>
);
