import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

/**
 * Responsive stat-card grid (dashboard-01 section-cards pattern): container
 * queries drive 1 → 2 → 4 columns from the grid's own width.
 */
export const StatCardGrid = ({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <div className={cn("@container/stat-grid", className)}>
    <div className="grid grid-cols-1 gap-4 @xl/stat-grid:grid-cols-2 @5xl/stat-grid:grid-cols-4">
      {children}
    </div>
  </div>
);

interface StatCardProps {
  /** Small muted label above the value (CardDescription slot). */
  readonly label: ReactNode;
  /** Headline value (rendered big + tabular). Omit when children carry the content. */
  readonly value?: ReactNode;
  /** Top-right slot (badge, icon button). */
  readonly action?: ReactNode;
  /** Custom content below the header for non-numeric stats. */
  readonly children?: ReactNode;
  /** Muted footnote row at the bottom. */
  readonly footer?: ReactNode;
  readonly className?: string;
}

/**
 * KPI/stat tile (dashboard-01 section-cards pattern): gradient-tinted Card with
 * label, big value, optional action badge and footnote.
 */
export const StatCard = ({ label, value, action, children, footer, className }: StatCardProps) => (
  <Card className={cn("from-primary/5 to-card dark:bg-card bg-gradient-to-t shadow-xs", className)}>
    <CardHeader>
      <CardDescription>{label}</CardDescription>
      {value === undefined ? null : (
        <CardTitle className="text-xl font-semibold tabular-nums">{value}</CardTitle>
      )}
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
    {children ? <CardContent>{children}</CardContent> : null}
    {footer ? (
      <CardFooter className="text-muted-foreground flex-col items-start gap-1 text-sm">
        {footer}
      </CardFooter>
    ) : null}
  </Card>
);
