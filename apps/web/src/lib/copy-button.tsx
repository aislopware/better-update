import { Button } from "@better-update/ui/components/ui/button";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { cn } from "@better-update/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";

import type { ButtonProps } from "@better-update/ui/components/ui/button";

import { useCopyToClipboard } from "./use-copy-to-clipboard";

const ICON_CLASS_BY_SIZE: Partial<Record<NonNullable<ButtonProps["size"]>, string>> = {
  icon: "size-4",
  "icon-sm": "size-3.5",
};

// Ghost icon button that copies `value` to the clipboard and toasts the outcome.
// Single source for the copy-to-clipboard affordance across the dashboard.
export const CopyButton = ({
  value,
  label,
  variant = "ghost",
  size = "icon-sm",
  iconClassName,
  className,
}: {
  value: string;
  label: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  iconClassName?: string;
  className?: string;
}) => {
  const { copied, copy } = useCopyToClipboard(1500);

  const handleCopy = async (event: React.MouseEvent) => {
    // Copying must never also trigger a clickable row's navigation.
    event.stopPropagation();
    const ok = await copy(value);
    toastManager.add(
      ok
        ? { title: `${label} copied`, type: "success" }
        : { title: "Failed to copy to clipboard", type: "error" },
    );
  };

  const Icon = copied ? CheckIcon : CopyIcon;
  const resolvedIconClass = iconClassName ?? (size ? ICON_CLASS_BY_SIZE[size] : undefined);

  return (
    <Button
      variant={variant}
      size={size}
      aria-label={`Copy ${label}`}
      onClick={handleCopy}
      className={className}
    >
      <Icon strokeWidth={2} className={resolvedIconClass} />
    </Button>
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
      {value.slice(0, length)}
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
