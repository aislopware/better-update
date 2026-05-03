import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

interface ListProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export const List = ({ children, className }: ListProps) => (
  <div
    className={cn("bg-card flex flex-col divide-y overflow-hidden rounded-xl border", className)}
  >
    {children}
  </div>
);

interface ListSectionHeaderProps {
  readonly children: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
}

export const ListSectionHeader = ({ children, trailing, className }: ListSectionHeaderProps) => (
  <div
    className={cn(
      "bg-muted/40 text-muted-foreground flex items-center gap-2 px-5 py-3 text-xs font-semibold tracking-wider uppercase",
      className,
    )}
  >
    <span className="flex-1">{children}</span>
    {trailing ? <span className="font-normal normal-case">{trailing}</span> : null}
  </div>
);

interface ListItemProps {
  readonly aside?: ReactNode;
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  readonly titleSuffix?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly meta?: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
}

export const ListItem = ({
  aside,
  leading,
  title,
  titleSuffix,
  subtitle,
  meta,
  trailing,
  className,
}: ListItemProps) => (
  <div
    className={cn(
      "group hover:bg-muted/40 flex items-stretch gap-4 px-5 py-4 transition-colors",
      className,
    )}
  >
    {aside ? (
      <div className="hidden min-w-44 shrink-0 flex-col justify-center gap-0.5 sm:flex">
        {aside}
      </div>
    ) : null}
    {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-foreground truncate text-sm leading-6 font-medium">{title}</span>
        {titleSuffix ? (
          <span className="text-muted-foreground/72 truncate text-xs">{titleSuffix}</span>
        ) : null}
      </div>
      {subtitle ? (
        <div className="text-muted-foreground truncate text-sm leading-5">{subtitle}</div>
      ) : null}
      {meta ? (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {meta}
        </div>
      ) : null}
    </div>
    {trailing ? (
      <div className="flex shrink-0 items-center justify-end gap-1">{trailing}</div>
    ) : null}
  </div>
);

interface ListFooterProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export const ListFooter = ({ children, className }: ListFooterProps) => (
  <div
    className={cn(
      "bg-muted/30 text-muted-foreground flex items-center justify-between gap-2 px-5 py-2.5 text-xs",
      className,
    )}
  >
    {children}
  </div>
);
