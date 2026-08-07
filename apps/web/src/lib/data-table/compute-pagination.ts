export const PAGE_SIZE = 20;

export interface Pagination {
  readonly totalPages: number;
  readonly safePage: number;
}

/**
 * Clamps a page number read out of the URL to the range the data actually has,
 * so deleting the last row of the last page does not strand the list on an
 * empty page. The showing-range itself belongs to the pagination footer, which
 * derives it from page/perPage/total.
 */
export const computePagination = (
  total: number,
  page: number,
  pageSize: number = PAGE_SIZE,
): Pagination => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { totalPages, safePage: Math.min(page, totalPages) };
};
