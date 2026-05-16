import type { SortingState } from "@tanstack/react-table";

/**
 * Convert API-style sort string ("createdAt" or "-createdAt") to SortingState.
 */
export const sortParamToSortingState = (sort: string): SortingState => {
  const desc = sort.startsWith("-");
  const id = desc ? sort.slice(1) : sort;
  if (!id) {
    return [];
  }
  return [{ id, desc }];
};

/**
 * Convert SortingState back to API-style sort string. Returns fallback when empty.
 */
export const sortingStateToSortParam = (state: SortingState, fallback: string): string => {
  const [first] = state;
  if (!first) {
    return fallback;
  }
  return first.desc ? `-${first.id}` : first.id;
};

/**
 * Normalize a sort string against allowed columns. Returns fallback when invalid.
 */
export const normalizeSortParam = <TColumn extends string>(
  sort: string,
  columns: readonly TColumn[],
  fallback: TColumn | `-${TColumn}`,
): TColumn | `-${TColumn}` => {
  const desc = sort.startsWith("-");
  const id = desc ? sort.slice(1) : sort;
  const column = columns.find((candidate) => candidate === id);
  if (!column) {
    return fallback;
  }
  return desc ? `-${column}` : column;
};
