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

interface SettingCardProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  /** Danger-zone framing: destructive ring + matching footer divider. */
  readonly destructive?: boolean;
  readonly className?: string;
}

export const SettingCard = ({
  title,
  description,
  action,
  children,
  footer,
  destructive = false,
  className,
}: SettingCardProps) => (
  <Card
    className={cn(
      // A real border, not a ring: the ring is a separate box-shadow shape and
      // its anti-aliasing seams against the card edge on rounded corners.
      destructive &&
        "border-destructive/40 *:data-[slot=card-footer]:border-destructive/20 border ring-0",
      className,
    )}
  >
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
    {children ? <CardContent className="flex flex-col gap-4">{children}</CardContent> : null}
    {footer ? <CardFooter className="justify-end gap-2">{footer}</CardFooter> : null}
  </Card>
);
