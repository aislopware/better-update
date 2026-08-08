import { Badge } from "@better-update/ui/components/badge";
import { Separator } from "@better-update/ui/components/separator";
import { Toolbar } from "@better-update/ui/components/toolbar";
import { XIcon } from "@phosphor-icons/react";

/**
 * A filter the reader arrived with rather than picked.
 *
 * Following "View all updates" out of a runtime hands the list a value that no
 * control on the page offers, and a silently narrowed list is worse than an
 * unnarrowed one — the reader counts rows that are missing and has no idea why.
 * The chip states the value in the faceted filters' own anatomy and, since
 * there is nothing to pick, spends its click on the one thing left to do:
 * drop it.
 */
export const PinnedFilterChip = ({
  label,
  value,
  onClear,
}: {
  readonly label: string;
  readonly value: string;
  readonly onClear: () => void;
}) => (
  <Toolbar.Button onClick={onClear} aria-label={`Clear ${label} filter`}>
    {label}
    <Separator orientation="vertical" className="mx-0.5 my-auto data-[orientation=vertical]:h-4" />
    <Badge variant="secondary" className="px-1.5 font-normal">
      {value}
    </Badge>
    <XIcon weight="bold" />
  </Toolbar.Button>
);
