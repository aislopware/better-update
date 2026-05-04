import { Effect } from "effect";

interface CursorPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

/**
 * Drain a cursor-paginated list endpoint into a single array. CLI commands
 * that resolve names → IDs (e.g. branch lookup) need the full set, not a
 * page slice.
 */
export const drainCursor = <Item, Err, Req>(
  fetchPage: (cursor: string | undefined) => Effect.Effect<CursorPage<Item>, Err, Req>,
): Effect.Effect<readonly Item[], Err, Req> => {
  const loop = (
    accumulator: readonly Item[],
    cursor: string | undefined,
    pages: number,
  ): Effect.Effect<readonly Item[], Err, Req> =>
    fetchPage(cursor).pipe(
      Effect.flatMap((page) => {
        const next = [...accumulator, ...page.items];
        const { nextCursor } = page;
        const reachedLimit = pages + 1 >= MAX_PAGES || next.length >= PAGE_SIZE * MAX_PAGES;
        return nextCursor === null || reachedLimit
          ? Effect.succeed(next)
          : loop(next, nextCursor, pages + 1);
      }),
    );
  return loop([], undefined, 0);
};
