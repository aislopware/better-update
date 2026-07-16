import { Button } from "@better-update/ui/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@better-update/ui/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@better-update/ui/components/ui/popover";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";

import type { QueryFunction } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { DROPDOWN_FETCH_LIMIT } from "../queries/constants";

interface PageOf<T> {
  readonly items: readonly T[];
}

interface ServerSearchListResult<T> {
  readonly search: string;
  readonly handleSearchChange: (next: string) => void;
  readonly items: readonly T[];
  readonly isPending: boolean;
  /** The unfiltered first page is full — more items exist than the picker shows. */
  readonly defaultListTruncated: boolean;
}

// Loose factory shape so any api-client `queryOptions(...)` result is
// assignable under exactOptionalPropertyTypes: queryFn stays optional (as in
// TanStack's helper type) with a `never` context param (contravariance-safe
// against DataTag'd keys), staleTime stays unknown (number | function union
// upstream), and `T` is inferred from the page the queryFn resolves to.
interface ListQueryOptions<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn?: ((context: never) => Promise<PageOf<T>> | PageOf<T>) | undefined;
  readonly staleTime?: unknown;
}

// Rebuilds strict useQuery options from the loose factory shape. The `never`
// context widens back to the real one — React Query always calls queryFn with
// the context belonging to these very options.
const asQueryOptions = <T,>(options: ListQueryOptions<T>) => ({
  queryKey: options.queryKey,
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- widens the `never` context param back to the real one; React Query calls queryFn with the context these options were built with
  queryFn: options.queryFn as unknown as QueryFunction<PageOf<T>>,
  ...(options.staleTime === undefined
    ? {}
    : // eslint-disable-next-line typescript/no-unsafe-type-assertion -- every api-client factory sets a numeric staleTime; the loose `unknown` only exists for assignability
      { staleTime: options.staleTime as number }),
});

/**
 * Drives a server-searched picker: the empty-search list is the first page of
 * the unfiltered query; typing switches to a server-side substring search so
 * items beyond the fetch limit stay reachable. `makeOptions(undefined)` must
 * produce the default (unfiltered) list options and `makeOptions(query)` the
 * searched ones — both bounded by `DROPDOWN_FETCH_LIMIT`.
 */
export const useServerSearchList = <T,>(
  makeOptions: (query: string | undefined) => ListQueryOptions<T>,
): ServerSearchListResult<T> => {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const isSearching = deferredSearch.length > 0;

  const base = useQuery(asQueryOptions(makeOptions(undefined)));
  const searched = useQuery({
    ...asQueryOptions(makeOptions(deferredSearch)),
    enabled: isSearching,
    placeholderData: keepPreviousData,
  });
  const active = isSearching ? searched : base;

  return {
    search,
    handleSearchChange: setSearch,
    items: active.data?.items ?? [],
    isPending: active.isPending,
    defaultListTruncated: (base.data?.items.length ?? 0) >= DROPDOWN_FETCH_LIMIT,
  };
};

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  /** Optional richer row content; the plain label still names the selection. */
  readonly content?: ReactNode;
}

interface ServerSearchComboboxProps {
  readonly value: string;
  readonly onValueChange: (next: string) => void;
  readonly options: readonly ComboboxOption[];
  readonly search: string;
  readonly onSearchChange: (next: string) => void;
  readonly isPending: boolean;
  /** Show the "type to search all" hint when the default list is truncated. */
  readonly defaultListTruncated?: boolean;
  readonly placeholder: string;
  readonly searchPlaceholder?: string;
  readonly emptyMessage?: string;
  readonly ariaLabel?: string;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
}

/**
 * A Select-shaped picker whose option list is searched server-side — the
 * scalable replacement for Selects fed by a `DROPDOWN_FETCH_LIMIT` fetch, which
 * silently hide items beyond the first page. Pair with `useServerSearchList`.
 */
export const ServerSearchCombobox = ({
  value,
  onValueChange,
  options,
  search,
  onSearchChange,
  isPending,
  defaultListTruncated = false,
  placeholder,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches found.",
  ariaLabel,
  invalid,
  disabled,
}: ServerSearchComboboxProps) => {
  const [open, setOpen] = useState(false);
  // The selected option can drop out of `options` when the search narrows, so
  // remember its label at pick time to keep the trigger meaningful. A value
  // set from outside (URL state) that is beyond the fetched page falls back to
  // the raw value — honest, if less pretty than a label.
  const [pickedLabel, setPickedLabel] = useState<string | null>(null);
  const selectedLabel = value
    ? (options.find((option) => option.value === value)?.label ?? pickedLabel ?? value)
    : null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) {
          onSearchChange("");
        }
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        render={
          <Button type="button" variant="outline" className="w-full justify-between font-normal" />
        }
      >
        <span className={selectedLabel ? "truncate" : "text-muted-foreground truncate"}>
          {selectedLabel ?? placeholder}
        </span>
        <ChevronsUpDownIcon strokeWidth={2} className="text-muted-foreground size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-56 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={onSearchChange}
          />
          <CommandList>
            {/* CommandEmpty never fires with shouldFilter=false, so the empty
                state is manual. */}
            {options.length === 0 ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {isPending ? "Searching…" : emptyMessage}
              </div>
            ) : null}
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                data-checked={option.value === value}
                onSelect={() => {
                  setPickedLabel(option.label);
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                {option.content ?? <span className="truncate">{option.label}</span>}
              </CommandItem>
            ))}
            {defaultListTruncated && !search ? (
              <p className="text-muted-foreground border-t px-3 py-2 text-xs">
                Showing the first {DROPDOWN_FETCH_LIMIT} — type to search all.
              </p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
