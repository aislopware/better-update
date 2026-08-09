import { useMemo } from "react";

import type { SortingState } from "@tanstack/react-table";

import { normalizeSortParam, sortParamToSortingState, sortingStateToSortParam } from "./sort-param";
import { IN_PLACE, fireAndForget } from "./use-search-navigate";

// eslint-disable-next-line typescript/no-explicit-any -- TanStack Router's per-route navigate type is too narrow to capture generically; callers pass the typed Route.useNavigate() output
type SearchUpdater = (opts: any) => Promise<unknown>;

interface UseDataTableSearchOptions<TColumn extends string> {
  readonly sortColumns: readonly TColumn[];
  readonly defaultSort: TColumn | `-${TColumn}`;
  readonly sort: string;
  readonly navigate: SearchUpdater;
}

interface UseDataTableSearchResult<TColumn extends string> {
  readonly sorting: SortingState;
  readonly apiSort: TColumn | `-${TColumn}`;
  readonly onSortingChange: (
    updater: SortingState | ((prev: SortingState) => SortingState),
  ) => void;
  /** Set the sort token directly — for lists whose order is picked by name. */
  readonly onSortChange: (next: string) => void;
  readonly onPageChange: (next: number) => void;
}

export const useDataTableSearch = <TColumn extends string>({
  sortColumns,
  defaultSort,
  sort,
  navigate,
}: UseDataTableSearchOptions<TColumn>): UseDataTableSearchResult<TColumn> => {
  const sorting = useMemo(() => sortParamToSortingState(sort), [sort]);
  const apiSort = normalizeSortParam(sort, sortColumns, defaultSort);

  const onSortChange = (nextSort: string): void => {
    fireAndForget(
      navigate({
        ...IN_PLACE,
        search: (prev: Record<string, unknown>) => ({ ...prev, sort: nextSort, page: 1 }),
      }),
    );
  };

  const onSortingChange = (
    updater: SortingState | ((prev: SortingState) => SortingState),
  ): void => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    onSortChange(
      next.length === 0 ? defaultSort : sortingStateToSortParam(next.slice(0, 1), defaultSort),
    );
  };

  const onPageChange = (next: number): void => {
    fireAndForget(
      navigate({
        ...IN_PLACE,
        search: (prev: Record<string, unknown>) => ({ ...prev, page: next }),
      }),
    );
  };

  return { sorting, apiSort, onSortingChange, onSortChange, onPageChange };
};
