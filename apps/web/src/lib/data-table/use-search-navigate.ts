/**
 * Discard a Promise without awaiting it, satisfying the no-void lint rule.
 * Use when calling fire-and-forget Promise-returning functions
 * (e.g. TanStack Router's navigate) from synchronous handlers.
 */
export const fireAndForget = (promise: Promise<unknown>): void => {
  // eslint-disable-next-line eslint/no-void -- Fire-and-forget pattern at sync handler boundaries (e.g. TanStack Router navigate, mutate calls)
  void promise;
};
