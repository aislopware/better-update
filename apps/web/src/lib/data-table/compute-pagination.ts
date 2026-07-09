export const PAGE_SIZE = 20;

export interface Pagination {
  readonly totalPages: number;
  readonly safePage: number;
  readonly fromIndex: number;
  readonly toIndex: number;
}

export const computePagination = (
  total: number,
  itemCount: number,
  page: number,
  pageSize: number = PAGE_SIZE,
): Pagination => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const fromIndex = itemCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const toIndex = (safePage - 1) * pageSize + itemCount;
  return { totalPages, safePage, fromIndex, toIndex };
};
