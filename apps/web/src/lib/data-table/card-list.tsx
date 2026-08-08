import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

import { FilteredEmptyState } from "./list-empty-state";
import { ListFooterArea } from "./list-footer";

import type { FilteredEmptyProps } from "./list-empty-state";
import type { ListPaginationFooter } from "./list-footer";

export interface CardListProps<TItem> {
  readonly items: readonly TItem[];
  readonly getKey: (item: TItem) => string;
  readonly renderItem: (item: TItem) => ReactNode;
  readonly isPlaceholderData?: boolean | undefined;
  /** Plain footer text for lists that fetch everything at once. */
  readonly countLabel?: string | undefined;
  /** Paginated footer — supersedes `countLabel`, which it derives itself. */
  readonly pagination?: ListPaginationFooter | undefined;
  /** Shown when the list is empty and no filter is active. */
  readonly emptyMessage?: string | undefined;
  readonly filteredEmpty?: FilteredEmptyProps | undefined;
}

/**
 * The other list shape: one card per row instead of one table row per row.
 *
 * Use it where a row is a *place you go* rather than a set of values you scan —
 * projects, apps, anything with an identity and a couple of headline numbers.
 * A table is still right for records you compare column by column.
 *
 * Everything below the rows — pagination, filtered-empty, the dim while the
 * next page is in flight — is the table's, so the two shapes behave the same
 * under the same toolbar.
 */
export const CardList = <TItem,>({
  items,
  getKey,
  renderItem,
  isPlaceholderData = false,
  countLabel,
  pagination,
  emptyMessage,
  filteredEmpty,
}: CardListProps<TItem>) => {
  const handleClear = (): void => {
    filteredEmpty?.onClear();
  };
  const empty = filteredEmpty?.isFiltered ? (
    <FilteredEmptyState entity={filteredEmpty.entity} onClear={handleClear} />
  ) : (
    emptyMessage !== undefined && (
      <p className="text-kumo-subtle py-8 text-center text-sm">{emptyMessage}</p>
    )
  );
  return (
    <div
      className={cn(
        "flex flex-col gap-3 transition-opacity",
        isPlaceholderData ? "opacity-60" : "opacity-100",
      )}
    >
      {items.length === 0 ? (
        <div className="border-kumo-line rounded-lg border border-dashed">{empty}</div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((item) => (
            <li key={getKey(item)}>{renderItem(item)}</li>
          ))}
        </ul>
      )}
      <ListFooterArea
        countLabel={countLabel}
        pagination={pagination}
        isPlaceholderData={isPlaceholderData}
      />
    </div>
  );
};
