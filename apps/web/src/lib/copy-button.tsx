import { Button } from "@better-update/ui/components/button";
import { toast } from "@better-update/ui/components/toast";
import { cn } from "@better-update/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";

import type { ComponentProps } from "react";

import { useCopyToClipboard } from "./use-copy-to-clipboard";

type ButtonProps = ComponentProps<typeof Button>;
type ButtonSize = NonNullable<ButtonProps["size"]>;

// Kumo sizes the button box, not what we put inside it — lucide icons default
// to 24px and would blow the square out. Drop this once the icon sweep lands
// and Phosphor's 1em default takes over.
const ICON_CLASS_BY_SIZE: Record<ButtonSize, string> = {
  xs: "size-3",
  sm: "size-3.5",
  base: "size-4",
  lg: "size-4",
};

// Ghost icon button that copies `value` to the clipboard and toasts the outcome.
// Single source for the copy-to-clipboard affordance across the dashboard.
export const CopyButton = ({
  value,
  label,
  variant = "ghost",
  size = "sm",
  iconClassName,
  className,
}: {
  value: string;
  label: string;
  variant?: ButtonProps["variant"];
  size?: ButtonSize;
  iconClassName?: string;
  className?: string;
}) => {
  const { copied, copy } = useCopyToClipboard(1500);

  const handleCopy = async (event: React.MouseEvent) => {
    // Copying must never also trigger a clickable row's navigation.
    event.stopPropagation();
    const ok = await copy(value);
    if (ok) {
      toast.success(`${label} copied`);
    } else {
      toast.error("Failed to copy to clipboard");
    }
  };

  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <Button
      variant={variant}
      shape="square"
      size={size}
      aria-label={`Copy ${label}`}
      onClick={handleCopy}
      className={cn(className)}
      icon={<Icon strokeWidth={2} className={iconClassName ?? ICON_CLASS_BY_SIZE[size]} />}
    />
  );
};

// Truncated mono identifier whose copy button copies the FULL value.
// Use for long IDs (update group, build id, UDID) shown abbreviated in tables.
export const CopyableId = ({
  value,
  label,
  length = 8,
  className,
}: {
  value: string;
  label: string;
  length?: number;
  className?: string;
}) => (
  <span className={cn("inline-flex items-center gap-0.5", className)}>
    <code className="font-mono text-xs" title={value}>
      {value.length > length ? `${value.slice(0, length)}…` : value}
    </code>
    <CopyButton value={value} label={label} />
  </span>
);

// Mono value paired with a copy button — the canonical "copyable identifier" cell.
// Renders nothing copyable when the value is absent, falling back to an em dash.
export const CopyableMono = ({
  value,
  label,
  className,
}: {
  value: string | null | undefined;
  label: string;
  className?: string;
}) =>
  value === null || value === undefined || value === "" ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <span className="flex min-w-0 items-center gap-1">
      <span className={cn("min-w-0 font-mono text-xs break-all", className)}>{value}</span>
      <CopyButton value={value} label={label} />
    </span>
  );
