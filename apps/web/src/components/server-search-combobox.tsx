import { Button } from "@better-update/ui/components/button";
import { Combobox } from "@better-update/ui/components/combobox";
import { CaretDownIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";

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
  // Base UI holds the selected *option* rather than its id, and resolves the
  // trigger label from an explicit `label` on that object before consulting
  // `items` — so remembering the option picked keeps the trigger meaningful
  // once the search narrows it out of `options`. A value set from outside (URL
  // state) that is beyond the fetched page falls back to the raw value —
  // honest, if less pretty than a label.
  const [picked, setPicked] = useState<ComboboxOption | null>(null);
  const selected = useMemo(
    () =>
      value
        ? (options.find((option) => option.value === value) ??
          (picked?.value === value ? picked : { value, label: value }))
        : null,
    [value, options, picked],
  );

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(next: ComboboxOption | null) => {
        if (next) {
          setPicked(next);
          onValueChange(next.value);
        }
      }}
      // The server already filtered; show every item it returned.
      filter={null}
      inputValue={search}
      onInputValueChange={onSearchChange}
      itemToStringLabel={(option: ComboboxOption) => option.label}
      isItemEqualToValue={(option: ComboboxOption, other: ComboboxOption) =>
        option.value === other.value
      }
      // Reset after the exit animation so the list does not flash the
      // unfiltered page on the way out.
      onOpenChangeComplete={(next) => {
        if (!next) {
          onSearchChange("");
        }
      }}
      disabled={disabled}
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        render={
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-between font-normal"
          />
        }
      >
        <Combobox.Value>
          {(current: ComboboxOption | null) => (
            <span className={current ? "truncate" : "text-kumo-placeholder truncate"}>
              {current?.label ?? placeholder}
            </span>
          )}
        </Combobox.Value>
        <Combobox.Icon className="text-kumo-subtle flex shrink-0 items-center">
          <CaretDownIcon weight="bold" className="size-4" />
        </Combobox.Icon>
      </Combobox.Trigger>
      {/* Matches the trigger's width the way a Select's list does, with a floor
          so a narrow field still gets a readable list. */}
      <Combobox.Content className="w-(--anchor-width) min-w-56">
        <Combobox.Input placeholder={searchPlaceholder} />
        <Combobox.Empty>{isPending ? "Searching…" : emptyMessage}</Combobox.Empty>
        <Combobox.List>
          {(option: ComboboxOption) => (
            // Kumo lays the row out as `grid-cols-[1fr_16px]` — label, then room
            // for the tick. A grid track's automatic minimum is its content's,
            // so `1fr` there is a floor of min-content, not a share of the
            // width: a long label pushed the row wider than the popup instead of
            // truncating inside it. `minmax(0,…)` is what lets it give.
            <Combobox.Item
              key={option.value}
              value={option}
              className="grid-cols-[minmax(0,1fr)_16px]"
            >
              {/* `block`, because Kumo drops the row's children into a plain
                  div rather than making them grid items: an inline span cannot
                  be told to hide its overflow, so `truncate` alone was a no-op
                  and the label simply ran past the row. */}
              {option.content ?? <span className="block truncate">{option.label}</span>}
            </Combobox.Item>
          )}
        </Combobox.List>
        {defaultListTruncated && !search ? (
          <p className="text-kumo-subtle border-kumo-hairline border-t px-3 py-2 text-xs">
            Showing the first {DROPDOWN_FETCH_LIMIT} — type to search all.
          </p>
        ) : null}
      </Combobox.Content>
    </Combobox>
  );
};
