import { Badge } from "@better-update/ui/components/badge";
import { Button } from "@better-update/ui/components/button";
import { CommandPalette as Palette } from "@better-update/ui/components/command-palette";
import { Popover } from "@better-update/ui/components/popover";
import { Separator } from "@better-update/ui/components/separator";
import { cn } from "@better-update/ui/lib/utils";
import { CheckIcon, PlusCircleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import type { Icon } from "@phosphor-icons/react";

export interface FacetedFilterOption {
  readonly label: string;
  readonly value: string;
  readonly icon?: Icon;
  readonly count?: number;
}

export interface DataTableFacetedFilterProps {
  readonly title: string;
  readonly options: readonly FacetedFilterOption[];
  /** Currently selected values (URL search state — server-side filtering). */
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /**
   * Server-search mode (opt-in): when `onSearchChange` is provided the option
   * list arrives already filtered and the search input becomes controlled, so
   * the local match below stands down. Pair with `useServerSearchList`.
   */
  readonly search?: string;
  readonly onSearchChange?: (next: string) => void;
  readonly isPending?: boolean;
  /** Show the "type to search all" hint when the default list is truncated. */
  readonly defaultListTruncated?: boolean;
}

const MAX_BADGES = 2;

interface FilterEntry {
  readonly id: string;
  readonly option?: FacetedFilterOption;
  readonly run: () => void;
}

interface FilterGroup {
  readonly id: string;
  readonly items: FilterEntry[];
}

const SelectedSummary = ({
  options,
  selected,
}: {
  options: readonly FacetedFilterOption[];
  selected: readonly string[];
}) => (
  <>
    <Separator orientation="vertical" className="mx-0.5 my-auto data-[orientation=vertical]:h-4" />
    {/* Chips inherit the default Badge pill radius — no one-off shapes. */}
    <div className="flex gap-1">
      {selected.length > MAX_BADGES ? (
        <Badge variant="secondary" className="px-1.5 font-normal">
          {selected.length} selected
        </Badge>
      ) : (
        options
          .filter((option) => selected.includes(option.value))
          .map((option) => (
            <Badge key={option.value} variant="secondary" className="px-1.5 font-normal">
              {option.label}
            </Badge>
          ))
      )}
    </div>
  </>
);

/** Decoration, not a control: the row itself is the checkbox. */
const CheckSquare = ({ checked }: { checked: boolean }) => (
  <span
    className={cn(
      "ring-kumo-line flex size-4 shrink-0 items-center justify-center rounded-[4px] ring",
      checked ? "bg-kumo-brand text-kumo-inverse ring-kumo-brand" : "[&_svg]:invisible",
    )}
  >
    <CheckIcon weight="bold" className="size-3" />
  </span>
);

/**
 * Faceted filter chip: dashed outline trigger with selected-value badges,
 * opening the command palette's panel — the same keyboard model as ⌘K, minus
 * its dialog — over checkbox rows. Toggling keeps the popover open so several
 * values can be picked in one visit; filtering itself stays server-side.
 */
export const DataTableFacetedFilter = ({
  title,
  options,
  selected,
  onChange,
  search = "",
  onSearchChange,
  isPending = false,
  defaultListTruncated = false,
}: DataTableFacetedFilterProps) => {
  const [open, setOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const serverSearched = onSearchChange !== undefined;
  const query = serverSearched ? search : localSearch;

  const visible = useMemo(() => {
    if (serverSearched) {
      return options;
    }
    const needle = localSearch.trim().toLowerCase();
    return needle === ""
      ? options
      : options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [localSearch, options, serverSearched]);

  const groups = useMemo<FilterGroup[]>(
    () =>
      [
        {
          id: "options",
          items: visible.map((option) => ({
            id: option.value,
            option,
            run: () => {
              onChange(
                selected.includes(option.value)
                  ? selected.filter((entry) => entry !== option.value)
                  : [...selected, option.value],
              );
            },
          })),
        },
        {
          id: "clear",
          items:
            selected.length > 0
              ? [
                  {
                    id: "clear-filters",
                    run: () => {
                      onChange([]);
                      setOpen(false);
                    },
                  },
                ]
              : [],
        },
      ].filter((group) => group.items.length > 0),
    [visible, selected, onChange],
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next: boolean) => {
        if (!next) {
          onSearchChange?.("");
          setLocalSearch("");
        }
      }}
    >
      <Popover.Trigger render={<Button variant="secondary" className="border-dashed" />}>
        <PlusCircleIcon weight="bold" />
        {title}
        {selected.length > 0 ? <SelectedSummary options={options} selected={selected} /> : null}
      </Popover.Trigger>
      <Popover.Content className="w-56 p-0" align="start">
        <Palette.Panel
          items={groups}
          value={query}
          onValueChange={serverSearched ? onSearchChange : setLocalSearch}
          itemToStringValue={(group: FilterGroup) => group.id}
          className="max-h-96 bg-transparent"
        >
          <Palette.Input placeholder={title} />
          <Palette.List className="ring-0">
            <Palette.Results>
              {(group: FilterGroup) => (
                <Palette.Group key={group.id} items={group.items}>
                  <Palette.Items>
                    {(entry: FilterEntry) => (
                      <Palette.Item
                        key={entry.id}
                        value={entry}
                        className={entry.option ? "" : "justify-center text-center"}
                        onClick={() => {
                          entry.run();
                        }}
                      >
                        {entry.option ? (
                          <>
                            <CheckSquare checked={selected.includes(entry.option.value)} />
                            {entry.option.icon ? (
                              <entry.option.icon
                                weight="bold"
                                className="text-kumo-subtle size-4 shrink-0"
                              />
                            ) : null}
                            <span className="truncate">{entry.option.label}</span>
                            {entry.option.count === undefined ? null : (
                              <span className="text-kumo-subtle ml-auto font-mono text-xs tabular-nums">
                                {entry.option.count}
                              </span>
                            )}
                          </>
                        ) : (
                          "Clear filters"
                        )}
                      </Palette.Item>
                    )}
                  </Palette.Items>
                </Palette.Group>
              )}
            </Palette.Results>
            {visible.length === 0 ? (
              <p className="text-kumo-subtle py-6 text-center text-sm">
                {serverSearched && isPending ? "Searching…" : "No results found."}
              </p>
            ) : null}
            {defaultListTruncated && !query ? (
              <p className="text-kumo-subtle border-kumo-hairline mt-1 border-t px-3 py-2 text-xs">
                Showing the first {options.length} — type to search all.
              </p>
            ) : null}
          </Palette.List>
        </Palette.Panel>
      </Popover.Content>
    </Popover>
  );
};
