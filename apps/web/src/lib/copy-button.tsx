import { Button } from "@better-update/ui/components/button";
import { toast } from "@better-update/ui/components/toast";
import { cn } from "@better-update/ui/lib/utils";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import type { ComponentProps } from "react";

import { useCopyToClipboard } from "./use-copy-to-clipboard";

type ButtonProps = ComponentProps<typeof Button>;
type ButtonSize = NonNullable<ButtonProps["size"]>;

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
      // No size class: a phosphor icon is 1em, so it tracks the button's own
      // type scale across every size variant.
      icon={<Icon weight="bold" className={iconClassName} />}
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

// The value itself as the copy target, rather than a value sitting next to a
// copy button. Use where the text is something the reader has to reproduce —
// a name they must retype to confirm a deletion — so the thing to copy and the
// thing to click are one and the same.
export const CopyChip = ({ value, className }: { value: string; className?: string }) => {
  const { copied, copy } = useCopyToClipboard(1500);
  const Icon = copied ? CheckIcon : CopyIcon;

  const handleCopy = async (): Promise<void> => {
    const ok = await copy(value);
    if (!ok) {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <button
      type="button"
      aria-label={`Copy ${value}`}
      onClick={handleCopy}
      className={cn(
        // `text-sm` rather than `text-xs`: this is monospace set inside a
        // sentence, and Kumo's own delete-resource chip is drawn one step below
        // its prose, not two.
        "bg-kumo-tint hover:bg-kumo-fill inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-sm font-semibold",
        className,
      )}
    >
      {value}
      {/* No colour change on the icon: the swap to a tick is the whole signal,
          and Kumo does not transition colour on hover. */}
      <Icon weight="bold" className="text-kumo-subtle" />
    </button>
  );
};

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
    <span className="text-kumo-subtle">—</span>
  ) : (
    <span className="flex min-w-0 items-center gap-1">
      <span className={cn("min-w-0 font-mono text-xs break-all", className)}>{value}</span>
      <CopyButton value={value} label={label} />
    </span>
  );
