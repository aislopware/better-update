import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/card";

import type { ReactNode } from "react";

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
 * KPI/stat tile (dashboard-01 section-cards pattern): plain Card with label,
 * big tabular value, optional action badge and footnote.
 */
export const StatCard = ({ label, value, action, children, footer, className }: StatCardProps) => (
  <Card className={className}>
    <CardHeader>
      <CardDescription>{label}</CardDescription>
      {value === undefined ? null : (
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      )}
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
    {children ? <CardContent>{children}</CardContent> : null}
    {footer ? (
      <CardFooter className="text-kumo-subtle flex-col items-start gap-1 text-sm">
        {footer}
      </CardFooter>
    ) : null}
  </Card>
);
