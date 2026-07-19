import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@better-update/ui/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@better-update/ui/components/ui/popover";
import { Separator } from "@better-update/ui/components/ui/separator";
import { cn } from "@better-update/ui/lib/utils";
import { CheckIcon, CirclePlusIcon } from "lucide-react";
import { useState } from "react";

import type { LucideIcon } from "lucide-react";

export interface FacetedFilterOption {
  readonly label: string;
  readonly value: string;
  readonly icon?: LucideIcon;
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
   * list is filtered server-side — cmdk's client filtering turns off and the
   * search input becomes controlled. Pair with `useServerSearchList`.
   */
  readonly search?: string;
  readonly onSearchChange?: (next: string) => void;
  readonly isPending?: boolean;
  /** Show the "type to search all" hint when the default list is truncated. */
  readonly defaultListTruncated?: boolean;
}

const MAX_BADGES = 2;

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

/**
 * Faceted filter chip (shadcn data-table pattern): dashed outline trigger with
 * selected-value badges, opening a Command popover with checkbox items.
 * Controlled by URL search state — filtering itself stays server-side.
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
  const serverSearched = onSearchChange !== undefined;

  // Always multiselect: toggling keeps the popover open so several values can
  // be picked in one visit.
  const toggle = (value: string): void => {
    onChange(
      selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value],
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          onSearchChange?.("");
        }
      }}
    >
      <PopoverTrigger render={<Button variant="outline" className="border-dashed" />}>
        <CirclePlusIcon strokeWidth={2} />
        {title}
        {selected.length > 0 ? <SelectedSummary options={options} selected={selected} /> : null}
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command shouldFilter={!serverSearched}>
          {serverSearched ? (
            <CommandInput placeholder={title} value={search} onValueChange={onSearchChange} />
          ) : (
            <CommandInput placeholder={title} />
          )}
          <CommandList>
            {/* CommandEmpty never fires with shouldFilter=false, so the
                server-searched empty state is manual. */}
            {serverSearched ? null : <CommandEmpty>No results found.</CommandEmpty>}
            {serverSearched && options.length === 0 ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {isPending ? "Searching…" : "No results found."}
              </div>
            ) : null}
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => {
                      toggle(option.value);
                    }}
                  >
                    <span
                      className={cn(
                        "border-input flex size-4 items-center justify-center rounded-[4px] border",
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "[&_svg]:invisible",
                      )}
                    >
                      <CheckIcon strokeWidth={2.5} className="size-3" />
                    </span>
                    {option.icon ? (
                      <option.icon strokeWidth={2} className="text-muted-foreground" />
                    ) : null}
                    <span className="truncate">{option.label}</span>
                    {option.count === undefined ? null : (
                      <span className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
                        {option.count}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      onChange([]);
                      setOpen(false);
                    }}
                    className="justify-center text-center"
                  >
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
            {defaultListTruncated && !search ? (
              <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                Showing the first {options.length} — type to search all.
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
