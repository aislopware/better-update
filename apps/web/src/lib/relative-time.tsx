import { formatShortDateTime } from "./format-date";
import { formatRelativeTime } from "./format-relative-time";

import type { DateInput } from "./format-date";

// Canonical timestamp cell: relative text with the absolute datetime on hover.
export const RelativeTime = ({
  value,
  className,
}: {
  value: DateInput | null | undefined;
  className?: string;
}) =>
  value ? (
    <span title={formatShortDateTime(value)} className={className}>
      {formatRelativeTime(value)}
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
