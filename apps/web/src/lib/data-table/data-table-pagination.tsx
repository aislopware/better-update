import { Pagination } from "@better-update/ui/components/pagination";

export interface DataTablePaginationProps {
  /** 1-indexed, already clamped to the last page. */
  readonly page: number;
  readonly perPage: number;
  readonly totalCount: number;
  /** Entity noun, already pluralised for `totalCount` — "builds", "branch". */
  readonly entity: string;
  /** Appends "(filtered)" so the count is not read as the size of the whole set. */
  readonly isFiltered?: boolean | undefined;
  /** Page changes are dropped while the previous page is still in flight. */
  readonly isPlaceholderData?: boolean | undefined;
  readonly onChange: (next: number) => void;
}

/**
 * Footer below a data table: the showing-range on the left, Kumo's page
 * controls on the right. Kumo derives the range from page/perPage/totalCount,
 * so the entity noun is all a caller supplies.
 *
 * The controls drop out once everything fits on one page — a row of permanently
 * disabled buttons reads as a broken control rather than an absent one.
 */
export const DataTablePagination = ({
  page,
  perPage,
  totalCount,
  entity,
  isFiltered = false,
  isPlaceholderData = false,
  onChange,
}: DataTablePaginationProps) => (
  <Pagination
    page={page}
    perPage={perPage}
    totalCount={totalCount}
    setPage={(next) => {
      if (!isPlaceholderData) {
        onChange(next);
      }
    }}
  >
    <Pagination.Info>
      {({ pageShowingRange }) => (
        <>
          <span className="tabular-nums">{pageShowingRange}</span> of{" "}
          <span className="tabular-nums">{totalCount}</span> {entity}
          {isFiltered ? " (filtered)" : null}
        </>
      )}
    </Pagination.Info>
    {totalCount > perPage ? <Pagination.Controls /> : null}
  </Pagination>
);
