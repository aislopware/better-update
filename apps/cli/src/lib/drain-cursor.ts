import { Effect } from "effect";

interface NumberedPage<Item> {
  readonly items: readonly Item[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

const MAX_PAGES = 100;

/**
 * Drain a page-numbered list endpoint into a single array. Used by CLI
 * commands that need the full set, not a page slice.
 */
export const drainPages = <Item, Err, Req>(
  fetchPage: (page: number) => Effect.Effect<NumberedPage<Item>, Err, Req>,
): Effect.Effect<readonly Item[], Err, Req> => {
  const loop = (
    accumulator: readonly Item[],
    page: number,
  ): Effect.Effect<readonly Item[], Err, Req> =>
    fetchPage(page).pipe(
      Effect.flatMap((response) => {
        const next = [...accumulator, ...response.items];
        const fetched = page * response.limit;
        const reachedLimit = page >= MAX_PAGES || next.length >= response.total;
        return reachedLimit || fetched >= response.total
          ? Effect.succeed(next)
          : loop(next, page + 1);
      }),
    );
  return loop([], 1);
};
