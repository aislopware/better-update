/**
 * Discard a Promise without awaiting it, satisfying the no-void lint rule.
 * Use when calling fire-and-forget Promise-returning functions
 * (e.g. TanStack Router's navigate) from synchronous handlers.
 */
export const fireAndForget = (promise: Promise<unknown>): void => {
  // eslint-disable-next-line eslint/no-void -- Fire-and-forget pattern at sync handler boundaries (e.g. TanStack Router navigate, mutate calls)
  void promise;
};

/**
 * What it means to change a list's own search state: the same route, and the
 * reader left where they were standing.
 *
 * `resetScroll` is the part that has to be said. TanStack Router treats every
 * navigation as arriving somewhere new and puts you at the top, which is right
 * for a link and wrong for a filter — picking a value from a toolbar halfway
 * down a page threw the page back to its title, and the list you were reading
 * with it. Spread this rather than writing `to: "."` by hand, so a new list
 * cannot be the one that forgets.
 *
 * `replace` is deliberately not here: whether a filter change is worth a step
 * in the back button is the page's call, not this rule's.
 */
export const IN_PLACE = { to: ".", resetScroll: false } as const;
