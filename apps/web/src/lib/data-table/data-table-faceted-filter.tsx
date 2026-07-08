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
    <div className="flex gap-1">
      {selected.length > MAX_BADGES ? (
        <Badge variant="secondary" className="rounded-sm px-1.5 font-normal">
          {selected.length} selected
        </Badge>
      ) : (
        options
          .filter((option) => selected.includes(option.value))
          .map((option) => (
            <Badge key={option.value} variant="secondary" className="rounded-sm px-1.5 font-normal">
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
}: DataTableFacetedFilterProps) => {
  const [open, setOpen] = useState(false);

  // Always multiselect: toggling keeps the popover open so several values can
  // be picked in one visit.
  const toggle = (value: string): void => {
    onChange(
      selected.includes(value) ? selected.filter((entry) => entry !== value) : [...selected, value],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" className="border-dashed" />}>
        <CirclePlusIcon strokeWidth={2} />
        {title}
        {selected.length > 0 ? <SelectedSummary options={options} selected={selected} /> : null}
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
