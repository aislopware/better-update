import { Button } from "@better-update/ui/components/button";
import { InlineCopyText } from "@better-update/ui/components/inline-copy-text";
import { toast } from "@better-update/ui/components/toast";
import { cn } from "@better-update/ui/lib/utils";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import type { ComponentProps, MouseEvent } from "react";

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
  title,
}: {
  value: string;
  label: string;
  variant?: ButtonProps["variant"];
  size?: ButtonSize;
  iconClassName?: string;
  className?: string;
  /** Hover text — for the caller that shows the button instead of the value. */
  title?: string;
}) => {
  const { copied, copy } = useCopyToClipboard(1500);

  const handleCopy = async (event: MouseEvent) => {
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
      title={title}
      onClick={handleCopy}
      className={cn(className)}
      // No size class: a phosphor icon is 1em, so it tracks the button's own
      // type scale across every size variant.
      icon={<Icon weight="bold" className={iconClassName} />}
    />
  );
};

// Copying must never also trigger a clickable row's navigation.
const stopRowNavigation = (event: MouseEvent): void => {
  event.stopPropagation();
};

// Kumo's inline copy control under the dashboard's conventions: the value is
// the click target (its icon shows on hover, or on the hovered table row), the
// accessible name stays `Copy <label>`, success toasts like `CopyButton`, and
// the text keeps the `text-xs` and inherited colour of the mono it replaced (a
// muted sub-line stays muted; Kumo's `Text` would force the default ink).
// `title` carries the full value wherever the visible text is abbreviated.
export const CopyableText = ({
  value,
  label,
  children,
  title = value,
  wrap = false,
  className,
}: {
  value: string;
  label: string;
  /** What to show; defaults to `value`. */
  children?: string;
  /** Hover text; defaults to the full `value`. */
  title?: string;
  /** Break a long value across lines instead of truncating it. */
  wrap?: boolean;
  className?: string | undefined;
}) => (
  <InlineCopyText
    variant="mono"
    value={value}
    title={title}
    truncate={!wrap}
    labels={{ copyAction: `Copy ${label}`, copied: `${label} copied` }}
    onClick={stopRowNavigation}
    onCopy={() => {
      toast.success(`${label} copied`);
    }}
    className={cn(
      "text-left [&>span:first-child]:text-xs [&>span:first-child]:text-inherit",
      wrap && "[&>span:first-child]:break-all",
      className,
    )}
  >
    {children ?? value}
  </InlineCopyText>
);

// Truncated mono identifier that copies the FULL value.
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
  <CopyableText value={value} label={label} className={className}>
    {value.length > length ? `${value.slice(0, length)}…` : value}
  </CopyableText>
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

// The canonical "copyable identifier" cell: the whole mono value, wrapped
// rather than truncated, copyable in place. Renders nothing copyable when the
// value is absent, falling back to an em dash.
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
    <CopyableText value={value} label={label} wrap className={className} />
  );
