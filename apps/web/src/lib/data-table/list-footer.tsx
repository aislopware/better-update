import { DataTablePagination } from "./data-table-pagination";

import type { DataTablePaginationProps } from "./data-table-pagination";

/** What a caller supplies; `isPlaceholderData` comes from the view itself. */
export type ListPaginationFooter = Omit<DataTablePaginationProps, "isPlaceholderData">;

export interface ListFooterProps {
  /** Plain footer text for lists that fetch everything at once. */
  readonly countLabel: string | undefined;
  /** Paginated footer — supersedes `countLabel`, which it derives itself. */
  readonly pagination: ListPaginationFooter | undefined;
  readonly isPlaceholderData: boolean;
}

/** The line under a list, whichever shape the list itself takes. */
export const ListFooterArea = ({ countLabel, pagination, isPlaceholderData }: ListFooterProps) => {
  if (pagination) {
    const { onChange: handlePageChange, ...rest } = pagination;
    return (
      <DataTablePagination
        page={rest.page}
        perPage={rest.perPage}
        totalCount={rest.totalCount}
        entity={rest.entity}
        isFiltered={rest.isFiltered}
        isPlaceholderData={isPlaceholderData}
        onChange={handlePageChange}
      />
    );
  }
  return countLabel === undefined ? null : (
    <span className="text-kumo-subtle text-xs tabular-nums">{countLabel}</span>
  );
};
