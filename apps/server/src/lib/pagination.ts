export const parsePagination = (
  urlParams: { page?: number | undefined; limit?: number | undefined },
  defaultLimit = 20,
) => {
  const page = urlParams.page ?? 1;
  const limit = urlParams.limit ?? defaultLimit;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};
