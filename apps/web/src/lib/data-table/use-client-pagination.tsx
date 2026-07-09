import { useState } from "react";

import { pluralize } from "../pluralize";
import { PAGE_SIZE, computePagination } from "./compute-pagination";
import { DataTablePagination } from "./data-table-pagination";

export interface ClientPaginationState<T> {
  readonly pageItems: readonly T[];
  readonly countLabel: string;
  readonly safePage: number;
  readonly totalPages: number;
  readonly setPage: (next: number) => void;
}

/**
 * Client-side pagination for fetch-all lists: slices `items` into PAGE_SIZE
 * pages and feeds the shared pagination footer. Page state is local — when the
 * consuming list is filterable, key the component by the filter identity so a
 * filter change resets to page 1.
 */
export const useClientPagination = <T,>(
  items: readonly T[],
  noun: string,
): ClientPaginationState<T> => {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const { fromIndex, toIndex } = computePagination(items.length, pageItems.length, safePage);
  const countLabel = `${fromIndex}–${toIndex} of ${items.length} ${pluralize(items.length, noun)}`;
  return { pageItems, countLabel, safePage, totalPages, setPage };
};

/** Pagination footer for client-paginated lists; hidden while everything fits on one page. */
export const ClientPaginationFooter = ({ state }: { state: ClientPaginationState<unknown> }) =>
  state.totalPages > 1 ? (
    <DataTablePagination
      countLabel={state.countLabel}
      safePage={state.safePage}
      totalPages={state.totalPages}
      isPlaceholderData={false}
      onChange={(next) => {
        state.setPage(next);
      }}
    />
  ) : null;
